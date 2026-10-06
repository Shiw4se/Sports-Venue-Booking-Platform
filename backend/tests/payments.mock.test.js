// Payment pipeline test against stripe-mock (https://github.com/stripe/stripe-mock) — no Stripe account needed.
//   stripe-mock -http-port 12111
//   payment-service with STRIPE_SECRET_KEY=sk_test_123 STRIPE_WEBHOOK_SECRET=whsec_test STRIPE_API_BASE=http://localhost:12111
//   booking-service with a short PAYMENT_SWEEP_INTERVAL_MS (e.g. 2000)
//   node backend/tests/payments.mock.test.js            (E2E_API_URL overrides the gateway URL)
// Webhook events are signed locally with Stripe's own helper, so signature verification is the real thing.
// Not covered here (needs a real account): the hosted Checkout page and confirming via /payments/verify,
// because stripe-mock always reports sessions as unpaid.
const path = require('path');
const { createRequire } = require('module');

const userServiceRequire = createRequire(path.join(__dirname, '../user-service/package.json'));
const paymentServiceRequire = createRequire(path.join(__dirname, '../payment-service/package.json'));
userServiceRequire('dotenv').config({ path: path.join(__dirname, '../user-service/.env') });
const { Client } = userServiceRequire('pg');
const Stripe = paymentServiceRequire('stripe');

const API = process.env.E2E_API_URL || 'http://localhost:3000/api';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';
const stamp = Date.now();
let failures = 0;
let eventSeq = 0;

async function call(method, urlPath, { body, token } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function waitFor(fn, timeoutMs = 15000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = await fn();
        if (value) return value;
        await new Promise(r => setTimeout(r, 300));
    }
    return null;
}

function check(name, ok, detail = '') {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// A signed Stripe event exactly as Stripe would POST it
async function sendWebhook(type, object, { id } = {}) {
    const payload = JSON.stringify({
        id: id || `evt_mock_${stamp}_${++eventSeq}`,
        object: 'event',
        type,
        created: Math.floor(Date.now() / 1000),
        data: { object },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await fetch(API + '/payments/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
        body: payload,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const paidSession = (payment, bookingId, intent) => ({
    id: payment.stripe_session_id,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    amount_total: Math.round(Number(payment.amount) * 100),
    payment_intent: intent,
    client_reference_id: bookingId,
    metadata: { bookingId },
});

async function main() {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const emails = ['player', 'rival', 'admin'].map(n => `${n}-${stamp}@pay.test`);
    let venueId;

    const payment = (bookingId) => db.query('SELECT * FROM payments WHERE booking_id = $1', [bookingId]).then(r => r.rows[0]);
    const booking = (id) => db.query('SELECT * FROM bookings WHERE id = $1', [id]).then(r => r.rows[0]);
    const slotFree = (slotId) => db.query('SELECT is_available FROM available_slots WHERE id = $1', [slotId]).then(r => r.rows[0]?.is_available);
    const mailCount = (to, type) => db.query('SELECT count(*)::int AS n FROM emails WHERE to_email = $1 AND type = $2', [to, type]).then(r => r.rows[0].n);

    try {
        const health = await call('GET', '/health');
        check('all services up incl. payment', health.body?.status === 'ok' && health.body.services.payment === 'up', JSON.stringify(health.body?.services));

        for (const email of emails) await call('POST', '/user/register', { body: { name: 'Pay Tester', email, password: 'secret123' } });
        await db.query('UPDATE users SET role = $1 WHERE email = $2', ['admin', emails[2]]);
        const login = async (email) => (await call('POST', '/user/login', { body: { email, password: 'secret123' } })).body.token;
        const [playerT, rivalT, adminT] = await Promise.all(emails.map(login));
        const player = (await call('GET', '/user/profile', { token: playerT })).body;

        const venue = await call('POST', '/venue/create', { token: adminT, body: { name: `Pay Arena ${stamp}`, location: 'Test St', type: 'football_field', price_per_hour: 40 } });
        venueId = venue.body.id;
        const makeSlot = async (hoursAhead) => {
            const start = new Date(Date.now() + hoursAhead * 3600000);
            const end = new Date(start.getTime() + 90 * 60000); // 1.5 h × $40 = $60
            return (await call('POST', `/venue/createslot/${venueId}`, { token: adminT, body: { start_time: start, end_time: end } })).body;
        };

        // ---------- Create → pending_payment + Checkout URL ----------
        const slot1 = await makeSlot(30);
        const created = await call('POST', '/bookings/create', { token: playerT, body: { slot_id: slot1.id } });
        const b1 = created.body;
        check('booking awaits payment with a Checkout URL', created.status === 201 && b1.status === 'pending_payment'
            && /^https:\/\/checkout\.stripe\.com\//.test(b1.checkout_url || ''), `${created.status} ${b1?.status}`);
        const holdMs = new Date(b1.hold_expires_at) - Date.now();
        check('slot is held for ~30 minutes', holdMs > 25 * 60000 && holdMs <= 31 * 60000, `${Math.round(holdMs / 60000)} min`);
        check('held slot is unavailable', (await slotFree(slot1.id)) === false);
        const rival = await call('POST', '/bookings/create', { token: rivalT, body: { slot_id: slot1.id } });
        check('another player cannot book a held slot -> 409', rival.status === 409, rival.status);
        const p1 = await payment(b1.id);
        check('payment row is pending with the session id', p1?.status === 'pending' && /^cs_/.test(p1.stripe_session_id) && Number(p1.amount) === 60, JSON.stringify(p1 && { status: p1.status, amount: p1.amount }));
        check('no confirmation email before payment', (await mailCount(emails[0], 'booking_confirmed')) === 0);

        // ---------- Webhook: bad signature, then a paid session ----------
        const forged = await fetch(API + '/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=forged' }, body: '{}' });
        check('forged webhook signature -> 400', forged.status === 400, forged.status);

        const evt1 = `evt_mock_${stamp}_paid`;
        const hook = await sendWebhook('checkout.session.completed', paidSession(p1, b1.id, 'pi_mock_1'), { id: evt1 });
        check('checkout.session.completed accepted', hook.status === 200 && hook.body.received === true, JSON.stringify(hook.body));
        const b1Paid = await waitFor(async () => { const b = await booking(b1.id); return b.status === 'booked' && b.paid_at ? b : null; });
        check('booking is confirmed by the webhook', Boolean(b1Paid));
        const p1Paid = await payment(b1.id);
        check('payment is paid with the payment intent saved', p1Paid.status === 'paid' && p1Paid.stripe_payment_intent_id === 'pi_mock_1', p1Paid.status);
        check('exactly one confirmation email', (await waitFor(async () => (await mailCount(emails[0], 'booking_confirmed')) === 1 ? 1 : null)) === 1);

        const dup = await sendWebhook('checkout.session.completed', paidSession(p1, b1.id, 'pi_mock_1'), { id: evt1 });
        check('redelivered event is acknowledged as duplicate', dup.status === 200 && dup.body.duplicate === true, JSON.stringify(dup.body));
        const again = await sendWebhook('checkout.session.completed', paidSession(p1, b1.id, 'pi_mock_1'));
        check('a second paid event for the same session is harmless', again.status === 200);
        await new Promise(r => setTimeout(r, 800));
        check('still exactly one confirmation email', (await mailCount(emails[0], 'booking_confirmed')) === 1);

        const verify = await call('GET', `/payments/verify?session_id=${p1.stripe_session_id}`, { token: playerT });
        check('verify after payment -> paid', verify.status === 200 && verify.body.paymentStatus === 'paid', JSON.stringify(verify.body));
        const verifyRival = await call('GET', `/payments/verify?session_id=${p1.stripe_session_id}`, { token: rivalT });
        check("verify of someone else's session -> 404", verifyRival.status === 404, verifyRival.status);
        const payPaid = await call('POST', `/bookings/${b1.id}/pay`, { token: playerT });
        check('"pay" on a paid booking -> 409', payPaid.status === 409, payPaid.status);

        // ---------- Cancel a paid booking → refund ----------
        const cancel = await call('DELETE', `/bookings/${b1.id}`, { token: playerT });
        check('cancelling a paid booking issues a refund', cancel.status === 200 && cancel.body.refund?.amount === 60 && /refund/i.test(cancel.body.message), JSON.stringify(cancel.body));
        const b1Cancelled = await booking(b1.id);
        check('booking is cancelled and marked refunded', b1Cancelled.status === 'cancelled' && b1Cancelled.cancel_reason === 'user' && Boolean(b1Cancelled.refunded_at));
        const p1Refunded = await payment(b1.id);
        check('payment is refunded with a refund id', p1Refunded.status === 'refunded' && /^re_/.test(p1Refunded.refund_id || ''), p1Refunded.status);
        check('slot is free again', (await waitFor(() => slotFree(slot1.id))) === true);
        const cancelMail = await waitFor(() => db.query("SELECT text FROM emails WHERE to_email = $1 AND type = 'booking_cancelled' ORDER BY created_at DESC LIMIT 1", [emails[0]]).then(r => r.rows[0]));
        check('cancellation email mentions the refund', /refund of \$60\.00/i.test(cancelMail?.text || ''));
        const cancelAgain = await call('DELETE', `/bookings/${b1.id}`, { token: playerT });
        check('cancelling twice -> 409', cancelAgain.status === 409, cancelAgain.status);

        // ---------- Hold expiry, then a late payment → automatic refund ----------
        const late = (await call('POST', '/bookings/create', { token: playerT, body: { slot_id: slot1.id } })).body;
        check('freed slot can be held again', late?.status === 'pending_payment', late?.status);
        await db.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [late.id]);
        const expired = await waitFor(async () => { const b = await booking(late.id); return b.status === 'cancelled' && b.cancel_reason === 'payment_expired' ? b : null; }, 20000);
        check('expired hold is cancelled by the sweep', Boolean(expired));
        check('expired hold releases the slot', (await waitFor(() => slotFree(slot1.id))) === true);
        check('reservation-expired email sent', Boolean(await waitFor(async () => (await mailCount(emails[0], 'booking_expired')) === 1 ? 1 : null)));
        const pLate = await waitFor(async () => { const p = await payment(late.id); return p?.status === 'expired' ? p : null; });
        check('payment row is expired after the hold ran out', Boolean(pLate));

        const lateHook = await sendWebhook('checkout.session.completed', paidSession(pLate, late.id, 'pi_mock_late'));
        check('late payment webhook accepted', lateHook.status === 200, JSON.stringify(lateHook.body));
        const lateRefunded = await waitFor(async () => { const p = await payment(late.id); return p.status === 'refunded' ? p : null; });
        check('late payment is refunded automatically', Boolean(lateRefunded), lateRefunded?.status);
        // refunded_at arrives via the payment.refunded event, so give it a moment
        const lateBooking = await waitFor(async () => { const b = await booking(late.id); return b.refunded_at ? b : null; });
        check('late-paid booking stays cancelled and is marked refunded', lateBooking?.status === 'cancelled' && Boolean(lateBooking?.refunded_at));
        check('refund email for the late payment', Boolean(await waitFor(async () => (await mailCount(emails[0], 'payment_refunded')) === 1 ? 1 : null)));
        const verifyLate = await call('GET', `/payments/verify?session_id=${pLate.stripe_session_id}`, { token: playerT });
        check('verify of the late-paid session -> refunded', verifyLate.body?.paymentStatus === 'refunded', JSON.stringify(verifyLate.body));

        // ---------- "Pay now" and cancelling an unpaid booking ----------
        const again2 = (await call('POST', '/bookings/create', { token: playerT, body: { slot_id: slot1.id } })).body;
        const firstSession = (await payment(again2.id)).stripe_session_id;
        const payNow = await call('POST', `/bookings/${again2.id}/pay`, { token: playerT });
        const secondSession = (await payment(again2.id)).stripe_session_id;
        check('"pay now" issues a fresh Checkout Session', payNow.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(payNow.body.checkout_url || '') && secondSession !== firstSession, payNow.status);
        const verifyOpen = await call('GET', `/payments/verify?session_id=${secondSession}`, { token: playerT });
        check('verify of an unpaid session -> pending', verifyOpen.body?.paymentStatus === 'pending', JSON.stringify(verifyOpen.body));
        const cancelPending = await call('DELETE', `/bookings/${again2.id}`, { token: playerT });
        check('cancelling an unpaid booking -> 200 without refund', cancelPending.status === 200 && !cancelPending.body.refund, JSON.stringify(cancelPending.body));
        const pClosed = await waitFor(async () => { const p = await payment(again2.id); return p?.status === 'expired' ? p : null; });
        check('its Checkout Session is closed', Boolean(pClosed));

        // ---------- Admin and free slots never pay ----------
        const slot2 = await makeSlot(40);
        const adminBooking = await call('POST', '/bookings/create', { token: adminT, body: { slot_id: slot2.id } });
        check('admin booking is confirmed without payment', adminBooking.status === 201 && adminBooking.body.status === 'booked' && !adminBooking.body.checkout_url, adminBooking.body?.status);
        await call('PUT', `/venue/update/${venueId}`, { token: adminT, body: { price_per_hour: 0 } });
        const slot3 = await makeSlot(50);
        const freeBooking = await call('POST', '/bookings/create', { token: playerT, body: { slot_id: slot3.id } });
        check('free slot is booked without payment', freeBooking.status === 201 && freeBooking.body.status === 'booked' && !freeBooking.body.checkout_url, freeBooking.body?.status);
    } finally {
        if (venueId) await db.query('DELETE FROM venues WHERE id = $1', [venueId]);
        await db.query("DELETE FROM users WHERE email LIKE '%@pay.test'");
        await db.query("DELETE FROM emails WHERE to_email LIKE '%@pay.test'");
        await db.query("DELETE FROM stripe_events WHERE event_id LIKE $1", [`evt_mock_${stamp}_%`]);
        await db.end();
    }

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll payment checks passed (test data removed)');
    process.exit(failures ? 1 : 0);
}

main().catch((err) => {
    console.error('Payment test run failed:', err);
    process.exit(1);
});
