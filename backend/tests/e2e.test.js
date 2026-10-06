// End-to-end test against a running stack (gateway + 3 services + PostgreSQL + RabbitMQ).
//   npm run test:e2e
// E2E_API_URL overrides the gateway URL (default http://localhost:3000/api).
// The test creates its own users/venue and removes them at the end.
const path = require('path');
const { createRequire } = require('module');

const userServiceRequire = createRequire(path.join(__dirname, '../user-service/package.json'));
userServiceRequire('dotenv').config({ path: path.join(__dirname, '../user-service/.env') });
const { Client } = userServiceRequire('pg');

const API = process.env.E2E_API_URL || 'http://localhost:3000/api';

// Opt-in Stripe checks run only when payment-service has a test key configured
const paymentEnv = (() => {
    try {
        return userServiceRequire('dotenv').parse(require('fs').readFileSync(path.join(__dirname, '../payment-service/.env')));
    } catch {
        return {};
    }
})();
const STRIPE_ENABLED = Boolean(process.env.STRIPE_SECRET_KEY || paymentEnv.STRIPE_SECRET_KEY);
const STRIPE_MOCK = Boolean(process.env.STRIPE_API_BASE || paymentEnv.STRIPE_API_BASE);
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || paymentEnv.STRIPE_WEBHOOK_SECRET || 'whsec_test';
if (STRIPE_ENABLED && !STRIPE_MOCK) {
    console.error('With a real Stripe key this suite would issue refunds for fake payments. Run it with payments disabled or against stripe-mock (STRIPE_API_BASE); see backend/tests/payments.mock.test.js and README for the manual Stripe checklist.');
    process.exit(1);
}
const Stripe = STRIPE_ENABLED ? createRequire(path.join(__dirname, '../payment-service/package.json'))('stripe') : null;
const stamp = Date.now();
let failures = 0;

async function call(method, urlPath, { body, token } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(API + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
}

// Polls until fn returns something truthy (events are asynchronous)
async function waitFor(fn, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = await fn();
        if (value) return value;
        await new Promise(r => setTimeout(r, 300));
    }
    return null;
}

// Stripe mode: confirm a pending booking the way Stripe does — a signed checkout.session.completed event
async function confirmViaWebhook(db, bookingId) {
    const { rows: [payment] } = await db.query('SELECT stripe_session_id, amount FROM payments WHERE booking_id = $1', [bookingId]);
    const payload = JSON.stringify({
        id: `evt_e2e_${stamp}_${bookingId.slice(0, 8)}`, object: 'event', type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: payment.stripe_session_id, object: 'checkout.session', status: 'complete', payment_status: 'paid',
            amount_total: Math.round(Number(payment.amount) * 100), payment_intent: `pi_e2e_${bookingId.slice(0, 8)}`,
            client_reference_id: bookingId, metadata: { bookingId } } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
    const res = await fetch(API + '/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload });
    if (res.status !== 200) throw new Error(`webhook confirm failed: ${res.status}`);
    return waitFor(async () => {
        const { rows: [b] } = await db.query('SELECT status, paid_at FROM bookings WHERE id = $1', [bookingId]);
        return b?.status === 'booked' ? b : null;
    });
}

function check(name, ok, detail = '') {
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function main() {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    const emails = ['user', 'other', 'admin'].map(n => `${n}-${stamp}@e2e.test`);
    let venueId;

    try {
        const health = await call('GET', '/health');
        check('health: all services up', health.status === 200 && health.body.status === 'ok', JSON.stringify(health.body?.services));
        check('health includes the payment service', health.body?.services?.payment === 'up');
        const docs = await fetch(API + '/openapi.json');
        check('OpenAPI spec is served', docs.status === 200);

        for (const email of emails) {
            const r = await call('POST', '/user/register', { body: { name: 'E2E', email, password: 'secret123' } });
            check(`register ${email.split('-')[0]}`, r.status === 201, r.status);
        }
        const dup = await call('POST', '/user/register', { body: { name: 'E2E', email: emails[0], password: 'secret123' } });
        check('duplicate email -> 400', dup.status === 400, dup.status);
        const weak = await call('POST', '/user/register', { body: { name: 'E2E', email: `weak-${stamp}@e2e.test`, password: '1' } });
        check('short password -> 400', weak.status === 400, weak.status);

        await db.query('UPDATE users SET role = $1 WHERE email = $2', ['admin', emails[2]]);

        const login = async (email) => (await call('POST', '/user/login', { body: { email, password: 'secret123' } })).body?.token;
        const [userT, otherT, adminT] = [await login(emails[0]), await login(emails[1]), await login(emails[2])];
        check('login returns tokens', Boolean(userT && otherT && adminT));
        const bad = await call('POST', '/user/login', { body: { email: emails[0], password: 'wrong' } });
        check('wrong password -> 401', bad.status === 401, bad.status);

        const profile = await call('GET', '/user/profile', { token: userT });
        check('profile returns current user', profile.status === 200 && profile.body.name === 'E2E' && Boolean(profile.body.created_at));

        const renamed = await call('PUT', '/user/profile', { token: userT, body: { name: '  E2E Player ', avatar_color: '#7c3aed' } });
        check('update name and avatar color', renamed.status === 200 && renamed.body.name === 'E2E Player'
            && renamed.body.avatar_color === '#7c3aed', renamed.status);
        const badColor = await call('PUT', '/user/profile', { token: userT, body: { avatar_color: 'red' } });
        check('invalid avatar color -> 400', badColor.status === 400, badColor.status);
        const emptyName = await call('PUT', '/user/profile', { token: userT, body: { name: '   ' } });
        check('empty name -> 400', emptyName.status === 400, emptyName.status);

        const wrongPass = await call('PUT', '/user/password', { token: otherT, body: { currentPassword: 'nope', newPassword: 'newsecret1' } });
        check('change password with wrong current -> 400', wrongPass.status === 400, wrongPass.status);
        const newPass = await call('PUT', '/user/password', { token: otherT, body: { currentPassword: 'secret123', newPassword: 'newsecret1' } });
        check('change password', newPass.status === 200, newPass.status);
        const relogin = await call('POST', '/user/login', { body: { email: emails[1], password: 'newsecret1' } });
        check('login with the new password', relogin.status === 200, relogin.status);

        // Avatar upload: 1×1 PNG
        const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
        const notImage = await call('PUT', '/user/avatar', { token: userT, body: { dataUrl: 'data:text/plain;base64,aGVsbG8=' } });
        check('non-image avatar -> 400', notImage.status === 400, notImage.status);
        const tooBig = await call('PUT', '/user/avatar', { token: userT, body: { dataUrl: `data:image/png;base64,${'A'.repeat(420 * 1024)}` } });
        check('avatar over 300 KB -> 413', tooBig.status === 413, tooBig.status);
        const uploaded = await call('PUT', '/user/avatar', { token: userT, body: { dataUrl: PNG } });
        const avatarUrl = uploaded.body?.avatar_url;
        check('upload avatar', uploaded.status === 200 && /^\/api\/user\/avatar\/.+\?v=\d+$/.test(avatarUrl || ''), avatarUrl);

        const image = await fetch(API.replace(/\/api$/, '') + avatarUrl);
        const imageBytes = Buffer.from(await image.arrayBuffer());
        check('avatar is served as an image with long caching', image.status === 200
            && image.headers.get('content-type') === 'image/png'
            && /immutable/.test(image.headers.get('cache-control') || '')
            && imageBytes.length === Buffer.from(PNG.split(',')[1], 'base64').length, image.status);
        const withAvatar = await call('GET', '/user/profile', { token: userT });
        check('profile includes avatar_url', withAvatar.body?.avatar_url === avatarUrl);

        const removed = await call('DELETE', '/user/avatar', { token: userT });
        check('remove avatar', removed.status === 200 && removed.body.avatar_url === null, removed.status);
        const gone = await fetch(API + `/user/avatar/${withAvatar.body.id}`);
        check('removed avatar -> 404', gone.status === 404, gone.status);
        const badId = await fetch(API + '/user/avatar/not-a-uuid');
        check('avatar with malformed id -> 404', badId.status === 404, badId.status);

        const forbidden = await call('POST', '/venue/create', { token: userT, body: { name: 'X', location: 'Y', type: 'tennis_court' } });
        check('user cannot create venue -> 403', forbidden.status === 403, forbidden.status);
        const badType = await call('POST', '/venue/create', { token: adminT, body: { name: 'X', location: 'Y', type: 'football' } });
        check('invalid venue type -> 400', badType.status === 400, badType.status);
        const badPrice = await call('POST', '/venue/create', { token: adminT, body: { name: 'X', location: 'Y', type: 'tennis_court', price_per_hour: -5 } });
        check('negative price -> 400', badPrice.status === 400, badPrice.status);

        const badAmenity = await call('POST', '/venue/create', { token: adminT, body: { name: 'X', location: 'Y', type: 'tennis_court', amenities: ['jacuzzi'] } });
        check('unknown amenity -> 400', badAmenity.status === 400, badAmenity.status);
        const badCapacity = await call('POST', '/venue/create', { token: adminT, body: { name: 'X', location: 'Y', type: 'tennis_court', capacity: 0 } });
        check('capacity 0 -> 400', badCapacity.status === 400, badCapacity.status);

        const venue = await call('POST', '/venue/create', {
            token: adminT,
            body: {
                name: `E2E Arena ${stamp}`, location: 'Test St', type: 'football_field', price_per_hour: 40,
                surface: 'Artificial turf', indoor: true, capacity: 10, amenities: ['lighting', 'parking'],
            },
        });
        venueId = venue.body?.id;
        check('admin creates venue', venue.status === 201 && Boolean(venueId), venue.status);
        check('venue details are stored', venue.body?.indoor === true && venue.body?.capacity === 10
            && venue.body?.surface === 'Artificial turf' && venue.body?.amenities?.join() === 'lighting,parking');

        const upd = await call('PUT', `/venue/update/${venueId}`, { token: adminT, body: { description: 'updated' } });
        check('admin updates venue', upd.status === 200 && upd.body.description === 'updated', upd.status);

        // 1.5-hour slot tomorrow → price 40 × 1.5 = 60
        const start = new Date(Date.now() + 86400000);
        const end = new Date(start.getTime() + 90 * 60000);
        const slot = await call('POST', `/venue/createslot/${venueId}`, { token: adminT, body: { start_time: start, end_time: end } });
        check('admin creates slot', slot.status === 201, slot.status);
        const badSlot = await call('POST', `/venue/createslot/${venueId}`, { token: adminT, body: { start_time: end, end_time: start } });
        check('slot ending before start -> 400', badSlot.status === 400, badSlot.status);

        const all = await call('GET', '/venue/get_all');
        check('public venue list', all.status === 200 && all.body.some(v => v.id === venueId));
        const slots = await call('GET', `/venue/find_by_id/${venueId}`);
        check('public slot list', slots.status === 200 && slots.body.length === 1);
        // Regression: times used to shift by the server's UTC offset on read
        check('slot time round-trips without time zone shift',
            new Date(slots.body[0]?.start_time).getTime() === start.getTime(), slots.body[0]?.start_time);

        const slotId = slot.body.id;
        const [b1, b2] = await Promise.all([
            call('POST', '/bookings/create', { token: userT, body: { slot_id: slotId } }),
            call('POST', '/bookings/create', { token: otherT, body: { slot_id: slotId } }),
        ]);
        const statuses = [b1.status, b2.status].sort().join(',');
        check('concurrent booking: one 201, one 409', statuses === '201,409', statuses);
        const winner = b1.status === 201 ? { token: userT, booking: b1.body } : { token: otherT, booking: b2.body };
        const loserToken = winner.token === userT ? otherT : userT;
        check('booking price = hourly price × duration', Number(winner.booking.price) === 60, winner.booking.price);
        if (STRIPE_ENABLED) {
            check('with Stripe the booking awaits payment and has a Checkout URL',
                winner.booking.status === 'pending_payment' && /^https:\/\/checkout\.stripe\.com\//.test(winner.booking.checkout_url || ''),
                winner.booking.status);
            const holdMs = new Date(winner.booking.hold_expires_at) - Date.now();
            check('slot is held for ~30 minutes', holdMs > 25 * 60000 && holdMs <= 31 * 60000, Math.round(holdMs / 60000) + ' min');
            // The rest of the suite expects a confirmed booking: pay it via a signed webhook
            check('Stripe: signed webhook confirms the booking', Boolean(await confirmViaWebhook(db, winner.booking.id)));
            winner.booking.status = 'booked';
        } else {
            check('without Stripe the booking is confirmed immediately',
                winner.booking.status === 'booked' && !winner.booking.checkout_url, winner.booking.status);
        }
        const payBooked = await call('POST', `/bookings/${winner.booking.id}/pay`, { token: winner.token });
        check('"pay" on a confirmed booking -> 409', payBooked.status === 409, payBooked.status);

        const mine = await call('GET', `/bookings/${winner.booking.user_id}`, { token: winner.token });
        check('own bookings include venue name, type and location', mine.status === 200
            && mine.body[0]?.venue?.name === `E2E Arena ${stamp}`
            && mine.body[0]?.venue?.type === 'football_field'
            && mine.body[0]?.venue?.location === 'Test St');
        const spy = await call('GET', `/bookings/${winner.booking.user_id}`, { token: loserToken });
        check("other user's bookings -> 403", spy.status === 403, spy.status);
        const steal = await call('DELETE', `/bookings/${winner.booking.id}`, { token: loserToken });
        check("cancel other user's booking -> 404", steal.status === 404, steal.status);

        const statsForbidden = await call('GET', '/admin/stats', { token: userT });
        check('stats for regular user -> 403', statsForbidden.status === 403, statsForbidden.status);
        const stats = await call('GET', '/admin/stats', { token: adminT });
        const top = stats.body?.topVenues?.find(v => v.venueId === venueId);
        check('admin stats include the new booking', stats.status === 200 && stats.body.nextDays.length === 7
            && (!top || top.revenue >= 60), stats.status);

        const cancel = await call('DELETE', `/bookings/${winner.booking.id}`, { token: winner.token });
        check('owner cancels booking', cancel.status === 200, cancel.status);
        if (STRIPE_ENABLED) check('Stripe: cancelling the paid booking refunds it', cancel.body?.refund?.amount === 60, JSON.stringify(cancel.body));
        const again = await call('DELETE', `/bookings/${winner.booking.id}`, { token: winner.token });
        check('cancel twice -> 409', again.status === 409, again.status);
        const freed = await call('GET', `/venue/find_by_id/${venueId}`);
        check('slot is available again', freed.body[0]?.is_available === true);
        const rebook = await call('POST', '/bookings/create', { token: loserToken, body: { slot_id: slotId } });
        check('freed slot can be rebooked', rebook.status === 201, rebook.status);
        if (STRIPE_ENABLED) check('Stripe: rebooked slot confirmed via webhook', Boolean(await confirmViaWebhook(db, rebook.body.id)));

        // ---------- Recurring slots ----------
        const overlapSingle = await call('POST', `/venue/createslot/${venueId}`, { token: adminT, body: { start_time: start, end_time: end } });
        check('single slot overlapping an existing one -> 409', overlapSingle.status === 409, overlapSingle.status);
        const dayAfter = (h) => new Date(start.getTime() + 2 * 86400000 + h * 3600000);
        const bulk = await call('POST', `/venue/createslots/${venueId}`, {
            token: adminT,
            body: {
                slots: [
                    { start_time: dayAfter(0), end_time: dayAfter(1) },
                    { start_time: dayAfter(1), end_time: dayAfter(2) },
                    { start_time: dayAfter(1.5), end_time: dayAfter(2.5) }, // overlaps the previous one
                    { start_time: start, end_time: end },                   // overlaps an existing slot
                ],
            },
        });
        check('bulk slots: 2 created, 2 overlapping skipped', bulk.status === 201 && bulk.body.created === 2 && bulk.body.skipped === 2, JSON.stringify(bulk.body));
        const bulkForbidden = await call('POST', `/venue/createslots/${venueId}`, { token: userT, body: { slots: [] } });
        check('bulk slots for regular user -> 403', bulkForbidden.status === 403, bulkForbidden.status);

        // ---------- Favorites ----------
        const fav = await call('PUT', `/user/favorites/${venueId}`, { token: userT });
        check('add favorite', fav.status === 200 && fav.body.includes(venueId), fav.status);
        const favAgain = await call('PUT', `/user/favorites/${venueId}`, { token: userT });
        check('adding twice keeps one entry', favAgain.body.filter(id => id === venueId).length === 1);
        const favMissing = await call('PUT', '/user/favorites/00000000-0000-4000-8000-000000000000', { token: userT });
        check('favorite of unknown venue -> 404', favMissing.status === 404, favMissing.status);
        const favBad = await call('PUT', '/user/favorites/nope', { token: userT });
        check('favorite with malformed id -> 400', favBad.status === 400, favBad.status);
        const unfav = await call('DELETE', `/user/favorites/${venueId}`, { token: userT });
        check('remove favorite', unfav.status === 200 && !unfav.body.includes(venueId), unfav.status);

        // ---------- Venue photos ----------
        const photoForbidden = await call('POST', `/venue/${venueId}/photos`, { token: userT, body: { dataUrl: PNG } });
        check('photo upload by regular user -> 403', photoForbidden.status === 403, photoForbidden.status);
        const photo = await call('POST', `/venue/${venueId}/photos`, { token: adminT, body: { dataUrl: PNG } });
        const photoId = photo.body?.photo_ids?.[0];
        check('admin uploads a venue photo', photo.status === 201 && Boolean(photoId), photo.status);
        const photoImg = await fetch(`${API}/venue/photos/${photoId}`);
        check('photo is served as an image', photoImg.status === 200 && photoImg.headers.get('content-type') === 'image/png', photoImg.status);
        const listed = (await call('GET', '/venue/get_all')).body.find(v => v.id === venueId);
        check('venue list includes photo ids', listed?.photo_ids?.join() === photoId);
        const photoDel = await call('DELETE', `/venue/photos/${photoId}`, { token: adminT });
        check('admin deletes the photo', photoDel.status === 200 && photoDel.body.photo_ids.length === 0, photoDel.status);

        // ---------- Reviews ----------
        const upcomingReview = await call('POST', `/bookings/${rebook.body.id}/review`, { token: loserToken, body: { rating: 5 } });
        check('review before the game -> 409', upcomingReview.status === 409, upcomingReview.status);
        // pretend the game has been played
        await db.query("UPDATE bookings SET start_time = now() - interval '3 hours', end_time = now() - interval '2 hours' WHERE id = $1", [rebook.body.id]);
        const badRating = await call('POST', `/bookings/${rebook.body.id}/review`, { token: loserToken, body: { rating: 6 } });
        check('rating 6 -> 400', badRating.status === 400, badRating.status);
        const strangerReview = await call('POST', `/bookings/${rebook.body.id}/review`, { token: winner.token, body: { rating: 1 } });
        check("reviewing someone else's booking -> 404", strangerReview.status === 404, strangerReview.status);
        const review = await call('POST', `/bookings/${rebook.body.id}/review`, { token: loserToken, body: { rating: 5, comment: 'Great pitch' } });
        check('review a played game', review.status === 201, review.status);
        const reviewEdit = await call('POST', `/bookings/${rebook.body.id}/review`, { token: loserToken, body: { rating: 4, comment: 'Good pitch' } });
        check('edit own review', reviewEdit.status === 200 && reviewEdit.body.rating === 4, reviewEdit.status);
        const reviews = await call('GET', `/venue/${venueId}/reviews`);
        check('venue reviews: average, distribution, author', reviews.status === 200 && reviews.body.average === 4
            && reviews.body.count === 1 && reviews.body.distribution['4'] === 1 && /^E2E/.test(reviews.body.reviews[0]?.author?.name || '')
            && reviews.body.reviews[0]?.comment === 'Good pitch', JSON.stringify(reviews.body).slice(0, 120));
        const rated = await waitFor(async () => {
            const v = (await call('GET', '/venue/get_all')).body.find(x => x.id === venueId);
            return Number(v?.rating_avg) === 4 && v.rating_count === 1;
        });
        check('venue rating updated via event', Boolean(rated));
        const myReviewed = await call('GET', `/bookings/${rebook.body.user_id}`, { token: loserToken });
        check('own bookings include the review', myReviewed.body.find(b => b.id === rebook.body.id)?.review?.rating === 4);

        // ---------- Emails (dev mailbox) ----------
        const mailbox = async () => (await call('GET', '/admin/emails?limit=200', { token: adminT })).body?.emails || [];
        const mailFor = (email, type) => waitFor(async () => (await mailbox()).find(m => m.to_email === email && m.type === type));
        const forbiddenMailbox = await call('GET', '/admin/emails', { token: userT });
        check('mailbox for regular user -> 403', forbiddenMailbox.status === 403, forbiddenMailbox.status);
        check('welcome email after registration', Boolean(await mailFor(emails[0], 'welcome')));
        const winnerEmail = winner.token === userT ? emails[0] : emails[1];
        check('booking confirmation email', Boolean(await mailFor(winnerEmail, 'booking_confirmed')));
        check('booking cancellation email', Boolean(await mailFor(winnerEmail, 'booking_cancelled')));

        // Reminder: make the rebooked game start in 2 hours again and let the scheduler pick it up
        await db.query("UPDATE bookings SET start_time = now() + interval '2 hours', end_time = now() + interval '3 hours', reminder_sent_at = NULL WHERE id = $1", [rebook.body.id]);
        const loserEmail = loserToken === userT ? emails[0] : emails[1];
        check('day-before reminder email', Boolean(await mailFor(loserEmail, 'booking_reminder')));

        // ---------- Payments ----------
        const badSig = await fetch(API + '/payments/webhook', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: '{}',
        });
        check('webhook with a bad signature -> 400', badSig.status === 400, badSig.status);
        const noSig = await fetch(API + '/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        check('webhook without a signature -> 400', noSig.status === 400, noSig.status);
        const verifyUnknown = await call('GET', '/payments/verify?session_id=cs_test_nope', { token: userT });
        check('verify of an unknown session -> 404 / 503', [404, 503].includes(verifyUnknown.status), verifyUnknown.status);
        const verifyNoAuth = await call('GET', '/payments/verify?session_id=cs_test_nope');
        check('verify without a token -> 401', verifyNoAuth.status === 401, verifyNoAuth.status);

        if (STRIPE_ENABLED) {
            // A paid slot: booking awaits payment, the slot is held, "pay" issues a new session, the hold expires
            const s2 = new Date(start.getTime() + 3 * 3600000);
            const slot2 = await call('POST', `/venue/createslot/${venueId}`, { token: adminT, body: { start_time: s2, end_time: new Date(s2.getTime() + 3600000) } });
            const held = await call('POST', '/bookings/create', { token: userT, body: { slot_id: slot2.body.id } });
            check('Stripe: booking is pending with a Checkout URL', held.status === 201 && held.body.status === 'pending_payment'
                && /^https:\/\/checkout\.stripe\.com\//.test(held.body.checkout_url || ''), held.status);
            const heldSlot = (await call('GET', `/venue/find_by_id/${venueId}`)).body.find(s => s.id === slot2.body.id);
            check('Stripe: held slot is unavailable to others', heldSlot?.is_available === false);
            const other = await call('POST', '/bookings/create', { token: otherT, body: { slot_id: slot2.body.id } });
            check('Stripe: another player cannot book a held slot -> 409', other.status === 409, other.status);
            const payAgain = await call('POST', `/bookings/${held.body.id}/pay`, { token: userT });
            const sessionId = (await db.query('SELECT stripe_session_id FROM payments WHERE booking_id = $1', [held.body.id])).rows[0]?.stripe_session_id;
            check('Stripe: "pay" issues a fresh Checkout URL', payAgain.status === 200 && /^https:\/\/checkout\.stripe\.com\//.test(payAgain.body.checkout_url || ''), payAgain.status);
            const verifyOpen = await call('GET', `/payments/verify?session_id=${sessionId}`, { token: userT });
            check('Stripe: verify of an unpaid session -> pending', verifyOpen.status === 200 && verifyOpen.body.paymentStatus === 'pending', JSON.stringify(verifyOpen.body));

            // Expire the hold: the sweep releases the slot, emails the player and the session is closed
            await db.query("UPDATE bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = $1", [held.body.id]);
            const expired = await waitFor(async () => {
                const mine = (await call('GET', `/bookings/${held.body.user_id}`, { token: userT })).body;
                const b = mine.find(x => x.id === held.body.id);
                return b?.status === 'cancelled' && b.cancel_reason === 'payment_expired' ? b : null;
            }, 20000);
            check('Stripe: expired hold is cancelled with reason payment_expired', Boolean(expired));
            const freedSlot = await waitFor(async () => {
                const s = (await call('GET', `/venue/find_by_id/${venueId}`)).body.find(x => x.id === slot2.body.id);
                return s?.is_available ? s : null;
            });
            check('Stripe: expired hold releases the slot', Boolean(freedSlot));
            const verifyExpired = await waitFor(async () => {
                const v = await call('GET', `/payments/verify?session_id=${sessionId}`, { token: userT });
                return v.body?.paymentStatus === 'expired' ? v : null;
            });
            check('Stripe: verify after expiry -> expired', Boolean(verifyExpired));

            // Cancelling a pending booking needs no refund
            const held2 = await call('POST', '/bookings/create', { token: userT, body: { slot_id: slot2.body.id } });
            const cancelPending = await call('DELETE', `/bookings/${held2.body.id}`, { token: userT });
            check('Stripe: cancelling an unpaid booking -> 200 without refund', cancelPending.status === 200 && !cancelPending.body.refund, cancelPending.status);
            check('Stripe: reservation-expired email', Boolean(await mailFor(emails[0], 'booking_expired')));
        }

        // ---------- Password reset ----------
        const forgotUnknown = await call('POST', '/user/password/forgot', { body: { email: `nobody-${stamp}@e2e.test` } });
        check('forgot password for unknown email still 200', forgotUnknown.status === 200, forgotUnknown.status);
        const forgot = await call('POST', '/user/password/forgot', { body: { email: emails[0] } });
        check('forgot password', forgot.status === 200, forgot.status);
        const resetMail = await mailFor(emails[0], 'password_reset');
        const resetBody = resetMail && (await call('GET', `/admin/emails/${resetMail.id}`, { token: adminT })).body;
        const token = resetBody?.text?.match(/reset=([0-9a-f]{64})/)?.[1];
        check('reset email contains a link with a token', Boolean(token));
        const badReset = await call('POST', '/user/password/reset', { body: { token: 'f'.repeat(64), newPassword: 'whatever1' } });
        check('reset with a wrong token -> 400', badReset.status === 400, badReset.status);
        const reset = await call('POST', '/user/password/reset', { body: { token, newPassword: 'brandnew1' } });
        check('reset password with the token', reset.status === 200, reset.status);
        const resetLogin = await call('POST', '/user/login', { body: { email: emails[0], password: 'brandnew1' } });
        check('login with the reset password', resetLogin.status === 200, resetLogin.status);
        const reused = await call('POST', '/user/password/reset', { body: { token, newPassword: 'another1' } });
        check('reset token works only once', reused.status === 400, reused.status);

        const noAuth = await call('GET', '/bookings/x');
        check('no token -> 401', noAuth.status === 401, noAuth.status);
        const badUuid = await call('DELETE', '/bookings/not-a-uuid', { token: userT });
        check('malformed id -> 400', badUuid.status === 400, badUuid.status);
        const unknown = await call('GET', '/nope');
        check('unknown API route -> 404', unknown.status === 404, unknown.status);
    } finally {
        if (venueId) await db.query('DELETE FROM venues WHERE id = $1', [venueId]);
        await db.query("DELETE FROM users WHERE email LIKE '%@e2e.test'");
        await db.query("DELETE FROM emails WHERE to_email LIKE '%@e2e.test'");
        await db.query('DELETE FROM stripe_events WHERE event_id LIKE $1', [`evt_e2e_${stamp}_%`]);
        await db.end();
    }

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed (test data removed)');
    process.exit(failures ? 1 : 0);
}

main().catch((err) => {
    console.error('E2E run failed:', err);
    process.exit(1);
});
