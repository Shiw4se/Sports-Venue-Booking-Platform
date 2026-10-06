const { Op } = require('sequelize');
const { Payment, StripeEvent } = require('../models');
const { errorResponse } = require('../../shared/rpc');
const { stripe, enabled, webhookSecret, currency: defaultCurrency, holdMinutes, appUrl, timeZone } = require('../stripe');

// Set from consumer.js on startup
let rpc;
let publish = () => {};
const BOOKING_QUEUE = () => process.env.BOOKING_RPC_QUEUE || 'booking_rpc_queue';
const USER_QUEUE = () => process.env.USER_RPC_QUEUE || 'user_rpc_queue';

function setDeps(deps) {
    rpc = deps.rpc;
    publish = deps.publish;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_CENTS = 50; // Stripe's minimum charge in USD
const DISABLED = { status: 503, body: { message: 'Payments are not enabled' } };

const toCents = (amount) => Math.round(Number(amount) * 100);

// Stripe API errors become 502 (upstream problem), everything else goes through the usual mapping
function stripeErrorResponse(err, fallbackMessage) {
    if (err && typeof err.type === 'string' && err.type.startsWith('Stripe')) {
        console.error(fallbackMessage, err.message);
        return { status: 502, body: { message: `Stripe: ${err.message}` } };
    }
    return errorResponse(err, fallbackMessage);
}

// "Wednesday, October 7, 18:00–19:30" in the app time zone, for the Checkout page
function describeSlot(startTime, endTime) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone });
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });
    return `${day.format(new Date(startTime))}, ${time.format(new Date(startTime))}–${time.format(new Date(endTime))}`;
}

async function lookupEmail(userId) {
    try {
        const reply = await rpc.call(USER_QUEUE(), { action: 'validate_user', data: { userId } });
        return reply.status === 200 ? reply.body.email : undefined;
    } catch {
        return undefined;
    }
}

// Best effort: an open session the player can no longer use is closed so it cannot be paid later
async function expireSession(sessionId) {
    if (!sessionId) return;
    try {
        await stripe.checkout.sessions.expire(sessionId);
    } catch (err) {
        // already complete / expired → nothing to do
        if (!/expire|complete/i.test(err.message || '')) console.warn(`Could not expire session ${sessionId}:`, err.message);
    }
}

// ---------- Checkout ----------

// Creates a Stripe Checkout Session for a booking that booking-service has put into pending_payment
async function createCheckout({ bookingId, userId, amount, currency, venueName, startTime, endTime }) {
    if (!enabled) return { status: 200, body: { enabled: false } };
    if (!UUID_RE.test(bookingId || '') || !UUID_RE.test(userId || '')) {
        return { status: 400, body: { message: 'bookingId and userId are required' } };
    }
    const cents = toCents(amount);
    if (!Number.isFinite(cents) || cents < MIN_CENTS) {
        return { status: 400, body: { message: `Amount must be at least ${MIN_CENTS} cents` } };
    }

    try {
        const existing = await Payment.findOne({ where: { booking_id: bookingId } });
        if (existing && ['paid', 'refunded', 'refund_failed'].includes(existing.status)) {
            return { status: 409, body: { message: 'Booking is not awaiting payment' } };
        }
        if (existing?.stripe_session_id) await expireSession(existing.stripe_session_id);

        const expiresAt = Math.floor(Date.now() / 1000) + holdMinutes * 60;
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            submit_type: 'book',
            line_items: [{
                price_data: {
                    currency: (currency || defaultCurrency).toLowerCase(),
                    unit_amount: cents,
                    product_data: {
                        name: venueName || 'Court booking',
                        description: startTime && endTime ? describeSlot(startTime, endTime) : undefined,
                    },
                },
                quantity: 1,
            }],
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=cancelled&booking=${bookingId}`,
            customer_email: await lookupEmail(userId),
            client_reference_id: bookingId,
            metadata: { bookingId, userId },
            payment_intent_data: { metadata: { bookingId } },
            expires_at: expiresAt,
        });

        const values = {
            user_id: userId,
            amount: (cents / 100).toFixed(2),
            currency: (currency || defaultCurrency).toLowerCase(),
            stripe_session_id: session.id,
            stripe_payment_intent_id: null,
            status: 'pending',
        };
        if (existing) await existing.update(values);
        else await Payment.create({ booking_id: bookingId, ...values });

        return { status: 200, body: { enabled: true, sessionId: session.id, url: session.url, expiresAt } };
    } catch (err) {
        return stripeErrorResponse(err, 'Error creating checkout session');
    }
}

// ---------- Confirmation (shared by webhook and the return-to-site check; idempotent) ----------

const intentId = (session) => (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id) || null;

async function confirmPaidSession(session) {
    const bookingId = session.metadata?.bookingId || session.client_reference_id;
    if (!bookingId || !UUID_RE.test(bookingId)) return { outcome: 'ignored' }; // e.g. `stripe trigger` fixtures

    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    if (!payment) return { outcome: 'ignored' };
    if (payment.status === 'paid') return { outcome: 'already_booked', bookingId };
    if (['refunded', 'refund_failed'].includes(payment.status)) return { outcome: 'refunded', bookingId };

    if (session.amount_total !== toCents(payment.amount)) {
        console.warn(`Booking ${bookingId}: Stripe charged ${session.amount_total} cents, expected ${toCents(payment.amount)}`);
    }
    // Keep the payment intent even if confirming fails below: it is needed for any later refund
    await payment.update({ stripe_payment_intent_id: intentId(session), stripe_session_id: session.id });

    const reply = await rpc.call(BOOKING_QUEUE(), {
        action: 'mark_paid',
        data: { bookingId, paymentIntentId: intentId(session), amountCents: session.amount_total },
    });
    if (reply.status !== 200) throw new Error(`mark_paid failed for ${bookingId}: ${reply.status} ${reply.body?.message || ''}`);

    const { outcome, booking } = reply.body;
    if (outcome === 'booked' || outcome === 'already_booked') {
        await Payment.update({ status: 'paid' }, { where: { id: payment.id, status: 'pending' } });
        return { outcome, bookingId };
    }
    // The hold expired (slot released) before the payment landed: give the money back automatically
    console.warn(`Booking ${bookingId} was paid after its hold expired — refunding`);
    await refundPayment(await payment.reload(), { reason: 'late_payment', booking });
    return { outcome: 'refunded', bookingId };
}

// ---------- Refunds ----------

async function refundPayment(payment, { reason, booking }) {
    if (!payment.stripe_payment_intent_id) throw new Error(`Payment ${payment.id} has no payment intent to refund`);
    try {
        const refund = await stripe.refunds.create(
            { payment_intent: payment.stripe_payment_intent_id },
            { idempotencyKey: `refund:${payment.booking_id}` }
        );
        const [changed] = await Payment.update(
            { status: 'refunded', refund_id: refund.id },
            { where: { id: payment.id, status: { [Op.ne]: 'refunded' } } }
        );
        if (changed && reason !== 'user') {
            publish('payment.refunded', {
                ...(booking || {}),
                bookingId: payment.booking_id,
                userId: payment.user_id,
                amount: Number(payment.amount),
                reason,
            });
        }
        return refund;
    } catch (err) {
        await Payment.update({ status: 'refund_failed' }, { where: { id: payment.id } });
        throw err;
    }
}

// Called synchronously by booking-service when a player cancels a paid booking
async function refund({ bookingId }) {
    if (!enabled) return { status: 200, body: { refunded: false, reason: 'disabled' } };
    try {
        const payment = await Payment.findOne({ where: { booking_id: bookingId } });
        if (!payment) return { status: 200, body: { refunded: false, reason: 'not_paid' } };
        if (payment.status === 'refunded') {
            return { status: 200, body: { refunded: true, refundId: payment.refund_id, amount: Number(payment.amount), status: 'succeeded' } };
        }
        if (!['paid', 'refund_failed'].includes(payment.status)) {
            return { status: 200, body: { refunded: false, reason: 'not_paid' } };
        }
        const result = await refundPayment(payment, { reason: 'user' });
        return { status: 200, body: { refunded: true, refundId: result.id, amount: Number(payment.amount), status: result.status } };
    } catch (err) {
        return stripeErrorResponse(err, 'Error refunding payment');
    }
}

// ---------- Return-to-site check ----------

async function verifySession({ sessionId, userId }) {
    if (!enabled) return DISABLED;
    if (typeof sessionId !== 'string' || !sessionId.startsWith('cs_')) return { status: 400, body: { message: 'session_id is required' } };

    try {
        const payment = await Payment.findOne({ where: { stripe_session_id: sessionId } });
        if (!payment || payment.user_id !== userId) return { status: 404, body: { message: 'Payment not found' } };
        if (payment.status === 'paid') return { status: 200, body: { paymentStatus: 'paid', bookingId: payment.booking_id } };
        if (['refunded', 'refund_failed'].includes(payment.status)) return { status: 200, body: { paymentStatus: 'refunded', bookingId: payment.booking_id } };
        if (payment.status === 'expired') return { status: 200, body: { paymentStatus: 'expired', bookingId: payment.booking_id } };

        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (session.payment_status === 'paid') {
            const { outcome } = await confirmPaidSession(session);
            const paymentStatus = outcome === 'refunded' ? 'refunded' : 'paid';
            return { status: 200, body: { paymentStatus, bookingId: payment.booking_id } };
        }
        if (session.status === 'expired') {
            await Payment.update({ status: 'expired' }, { where: { id: payment.id, status: 'pending' } });
            return { status: 200, body: { paymentStatus: 'expired', bookingId: payment.booking_id } };
        }
        return { status: 200, body: { paymentStatus: 'pending', bookingId: payment.booking_id } };
    } catch (err) {
        return stripeErrorResponse(err, 'Error verifying payment');
    }
}

// ---------- Webhook ----------

async function dispatchEvent(event) {
    const object = event.data.object;
    switch (event.type) {
        case 'checkout.session.completed':
            if (object.payment_status === 'paid') await confirmPaidSession(object);
            break; // 'unpaid' = delayed payment method; async_payment_succeeded follows
        case 'checkout.session.async_payment_succeeded':
            await confirmPaidSession(object);
            break;
        case 'checkout.session.async_payment_failed':
            await Payment.update({ status: 'failed' }, { where: { stripe_session_id: object.id, status: 'pending' } });
            break;
        case 'checkout.session.expired':
            // The booking itself is released by booking-service's hold sweep
            await Payment.update({ status: 'expired' }, { where: { stripe_session_id: object.id, status: 'pending' } });
            break;
        case 'charge.refunded': {
            // Refund issued outside the app (Stripe Dashboard) — reflect it and tell the player
            const payment = await Payment.findOne({ where: { stripe_payment_intent_id: object.payment_intent } });
            if (!payment) break;
            const [changed] = await Payment.update(
                { status: 'refunded', refund_id: object.refunds?.data?.[0]?.id || payment.refund_id },
                { where: { id: payment.id, status: { [Op.in]: ['paid', 'refund_failed'] } } }
            );
            if (changed) {
                publish('payment.refunded', { bookingId: payment.booking_id, userId: payment.user_id, amount: Number(payment.amount), reason: 'external' });
            }
            break;
        }
        case 'refund.failed':
            await Payment.update({ status: 'refund_failed' }, { where: { stripe_payment_intent_id: object.payment_intent } });
            break;
        default:
            break;
    }
}

// The gateway forwards the raw body (base64) and the Stripe-Signature header untouched
async function handleWebhook({ rawBody, signature }) {
    if (!enabled || !webhookSecret || !signature || !rawBody) {
        return { status: 400, body: { message: 'Invalid signature' } };
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(Buffer.from(rawBody, 'base64'), signature, webhookSecret);
    } catch (err) {
        console.warn('Webhook signature verification failed:', err.message);
        return { status: 400, body: { message: 'Invalid signature' } };
    }

    // Stripe may deliver the same event more than once
    const [, created] = await StripeEvent.findOrCreate({ where: { event_id: event.id }, defaults: { type: event.type } });
    if (!created) return { status: 200, body: { received: true, duplicate: true } };

    try {
        await dispatchEvent(event);
        console.log(`[stripe] ${event.type} processed`);
        return { status: 200, body: { received: true } };
    } catch (err) {
        // Forget the event so Stripe's retry gets another chance
        await StripeEvent.destroy({ where: { event_id: event.id } });
        console.error(`[stripe] ${event.type} failed:`, err.message);
        return { status: 500, body: { message: 'Webhook processing failed' } };
    }
}

// ---------- Events from booking-service ----------

// Expired hold or cancelled while unpaid: close the Checkout Session so it cannot be paid later
async function onBookingReleased({ bookingId }) {
    const payment = await Payment.findOne({ where: { booking_id: bookingId, status: 'pending' } });
    if (!payment) return;
    if (enabled) await expireSession(payment.stripe_session_id);
    await Payment.update({ status: 'expired' }, { where: { id: payment.id, status: 'pending' } });
}

async function getByBooking({ bookingId }) {
    const payment = await Payment.findOne({ where: { booking_id: bookingId } });
    if (!payment) return { status: 404, body: { message: 'Payment not found' } };
    return { status: 200, body: payment };
}

module.exports = { setDeps, createCheckout, verifySession, handleWebhook, refund, onBookingReleased, getByBooking };
