const { Op, fn, col, literal } = require('sequelize');
const { Booking, Review } = require('../models');
const { errorResponse, RpcTimeoutError } = require('../../shared/rpc');

// The venue-service RPC client is set from consumer.js on startup
let venueRpc;
const VENUE_RPC_QUEUE = () => process.env.VENUE_RPC_QUEUE;

function setVenueRpc(client) {
    venueRpc = client;
}

// Domain-event publisher, set from consumer.js on startup
let publish = () => {};
function setEventPublisher(fn) {
    publish = fn;
}

const bookingEvent = (b) => ({
    bookingId: b.id,
    userId: b.user_id,
    venueId: b.venue_id,
    startTime: b.start_time,
    endTime: b.end_time,
    price: Number(b.price),
});

const DAY = 24 * 3600000;

// Payments (Stripe Checkout lives in payment-service; the same RPC client reaches every queue)
const PAYMENT_RPC_QUEUE = () => process.env.PAYMENT_RPC_QUEUE || 'payment_rpc_queue';
const HOLD_MS = () => (Number(process.env.PAYMENT_HOLD_MINUTES) || 30) * 60000;

// Asks payment-service for a Checkout Session. { enabled: false } means payments are switched off.
async function requestCheckout(booking, venueName) {
    try {
        const reply = await venueRpc.call(PAYMENT_RPC_QUEUE(), {
            action: 'create_checkout',
            data: {
                bookingId: booking.id,
                userId: booking.user_id,
                amount: Number(booking.price),
                venueName,
                startTime: booking.start_time,
                endTime: booking.end_time,
            },
        });
        if (reply.status !== 200) {
            const err = new Error(reply.body?.message || 'Payment service error');
            err.code = 'PAYMENT_ERROR';
            err.status = reply.status;
            throw err;
        }
        return reply.body;
    } catch (err) {
        if (err instanceof RpcTimeoutError) err.code = 'PAYMENT_UNAVAILABLE';
        throw err;
    }
}

const paymentErrorResponse = (err) => {
    if (err.code === 'PAYMENT_UNAVAILABLE') return { status: 503, body: { message: 'Payment service unavailable, please try again' } };
    if (err.code === 'PAYMENT_ERROR') return { status: err.status >= 500 ? 502 : err.status, body: { message: err.message } };
    return null;
};

async function releaseSlot(slotId) {
    try {
        await venueRpc.call(VENUE_RPC_QUEUE(), { action: 'release_slot', data: { slotId } });
    } catch (err) {
        console.error(`Failed to release slot ${slotId}:`, err);
    }
}

// Hourly venue price × slot duration, rounded to cents
function priceFor(slot) {
    const hours = (new Date(slot.end_time) - new Date(slot.start_time)) / 3600000;
    const perHour = Number(slot.venue?.price_per_hour) || 0;
    return Math.round(perHour * hours * 100) / 100;
}

// Creates a booking. userId/userRole come from the token (passed by api-gateway), not from the request body.
// Paid slots start as pending_payment with a Checkout URL; free slots and admins are booked immediately.
async function createBooking({ userId, userRole, slot_id: slotId }) {
    if (!userId || !slotId) {
        return { status: 400, body: { message: 'slot_id is required' } };
    }

    // 1. Atomically reserve the slot in venue-service (prevents double booking)
    const reserved = await venueRpc.call(VENUE_RPC_QUEUE(), { action: 'reserve_slot', data: { slotId } });
    if (reserved.status !== 200) return reserved;

    const slot = reserved.body;

    // 2. Create the booking; on failure release the slot (compensation)
    const price = priceFor(slot);
    const needsPayment = userRole !== 'admin' && price > 0;
    let booking = null;
    try {
        booking = await Booking.create({
            user_id: userId,
            venue_id: slot.venue_id,
            slot_id: slot.id,
            start_time: slot.start_time,
            end_time: slot.end_time,
            price,
            status: needsPayment ? 'pending_payment' : 'booked',
            hold_expires_at: needsPayment ? new Date(Date.now() + HOLD_MS()) : null,
            // Games starting within a day need no separate reminder: the confirmation covers it
            reminder_sent_at: new Date(slot.start_time) - Date.now() < DAY ? new Date() : null,
        });

        if (needsPayment) {
            const checkout = await requestCheckout(booking, slot.venue?.name);
            if (checkout.enabled) {
                return { status: 201, body: { ...booking.toJSON(), checkout_url: checkout.url } };
            }
            // Payments are switched off: confirm right away, exactly as before Stripe existed
            await booking.update({ status: 'booked', hold_expires_at: null });
        }

        publish('booking.created', bookingEvent(booking));
        return { status: 201, body: booking };
    } catch (err) {
        if (booking) await booking.destroy().catch(() => {});
        await releaseSlot(slot.id);
        return paymentErrorResponse(err) || errorResponse(err, 'Error creating booking');
    }
}

// "Pay now": a fresh Checkout Session for a booking that still awaits payment (extends the hold)
async function payBooking({ id, userId }) {
    try {
        const booking = await Booking.findByPk(id);
        if (!booking || booking.user_id !== userId) return { status: 404, body: { message: 'Booking not found' } };
        if (booking.status !== 'pending_payment') return { status: 409, body: { message: 'Booking does not await payment' } };

        const venues = await venueRpc.call(VENUE_RPC_QUEUE(), { action: 'get_venues_by_ids', data: { ids: [booking.venue_id] } });
        const checkout = await requestCheckout(booking, venues.body?.[0]?.name);
        if (!checkout.enabled) {
            await booking.update({ status: 'booked', hold_expires_at: null });
            publish('booking.created', bookingEvent(booking));
            return { status: 200, body: { booked: true } };
        }
        await booking.update({ hold_expires_at: new Date(Date.now() + HOLD_MS()) });
        return { status: 200, body: { checkout_url: checkout.url, hold_expires_at: booking.hold_expires_at } };
    } catch (err) {
        return paymentErrorResponse(err) || errorResponse(err, 'Error creating payment');
    }
}

// Called by payment-service once Stripe reports the session paid (webhook or return-to-site check).
// Idempotent: the conditional UPDATE confirms a booking exactly once, however many times it is called.
async function markPaid({ bookingId, paymentIntentId, amountCents }) {
    try {
        const [count, rows] = await Booking.update(
            { status: 'booked', paid_at: new Date(), hold_expires_at: null },
            { where: { id: bookingId, status: 'pending_payment' }, returning: true }
        );
        if (count === 1) {
            const booking = rows[0];
            if (amountCents !== Math.round(Number(booking.price) * 100)) {
                console.warn(`Booking ${bookingId}: paid ${amountCents} cents, price is ${booking.price} (intent ${paymentIntentId})`);
            }
            publish('booking.created', bookingEvent(booking));
            return { status: 200, body: { outcome: 'booked', booking: bookingEvent(booking) } };
        }

        const booking = await Booking.findByPk(bookingId);
        if (!booking) return { status: 404, body: { message: 'Booking not found' } };
        const outcome = booking.status === 'booked' ? 'already_booked' : 'cancelled';
        return { status: 200, body: { outcome, booking: bookingEvent(booking) } };
    } catch (err) {
        return errorResponse(err, 'Error confirming payment');
    }
}

// All of a user's bookings, with venue name, type and location
async function getBookingsByUser({ userId }) {
    try {
        const bookings = await Booking.findAll({
            where: { user_id: userId },
            include: { model: Review, as: 'review', attributes: ['rating', 'comment'] },
            order: [['start_time', 'DESC']],
        });

        const venueIds = [...new Set(bookings.map(b => b.venue_id))];
        const venuesResponse = await venueRpc.call(VENUE_RPC_QUEUE(), {
            action: 'get_venues_by_ids',
            data: { ids: venueIds },
        });
        const venues = new Map(
            (venuesResponse.status === 200 ? venuesResponse.body : []).map(v => [v.id, v])
        );

        const body = bookings.map(b => {
            const venue = venues.get(b.venue_id);
            return {
                ...b.toJSON(),
                venue: venue
                    ? { name: venue.name, type: venue.type, location: venue.location }
                    : { name: null, type: null, location: null },
            };
        });
        return { status: 200, body };
    } catch (err) {
        return errorResponse(err, 'Error fetching bookings');
    }
}

// Cancel a booking — owner only
async function cancelBooking({ id, userId }) {
    try {
        const booking = await Booking.findByPk(id);
        if (!booking || booking.user_id !== userId) {
            return { status: 404, body: { message: 'Booking not found' } };
        }
        if (booking.status === 'cancelled') {
            return { status: 409, body: { message: 'Booking is already cancelled' } };
        }

        // Paid bookings are refunded first; if Stripe refuses, the booking stays as it is
        let refund = null;
        if (booking.paid_at && !booking.refunded_at) {
            let reply;
            try {
                reply = await venueRpc.call(PAYMENT_RPC_QUEUE(), { action: 'refund', data: { bookingId: booking.id } });
            } catch (err) {
                return { status: 503, body: { message: 'Payment service unavailable, the booking was not cancelled. Please try again.' } };
            }
            if (reply.status !== 200) {
                return { status: 502, body: { message: 'Refund failed, the booking was not cancelled. Please try again.' } };
            }
            if (reply.body.refunded) {
                refund = { amount: reply.body.amount, status: reply.body.status };
                booking.refunded_at = new Date();
            }
        }

        booking.status = 'cancelled';
        booking.cancel_reason = 'user';
        await booking.save();
        await releaseSlot(booking.slot_id);
        publish('booking.cancelled', { ...bookingEvent(booking), reason: 'user', refund });

        return {
            status: 200,
            body: { message: refund ? 'Booking cancelled, refund issued' : 'Booking cancelled successfully', refund },
        };
    } catch (err) {
        return errorResponse(err, 'Error cancelling booking');
    }
}

// Hold sweep: unpaid bookings whose hold ran out are cancelled and their slots released.
// Runs periodically from consumer.js; the conditional UPDATE claims each booking once.
async function expirePendingBookings() {
    const now = new Date();
    const due = await Booking.findAll({
        where: { status: 'pending_payment', hold_expires_at: { [Op.lt]: now } },
        attributes: ['id'],
    });
    let released = 0;
    for (const { id } of due) {
        const [count, rows] = await Booking.update(
            { status: 'cancelled', cancel_reason: 'payment_expired' },
            { where: { id, status: 'pending_payment' }, returning: true }
        );
        if (count !== 1) continue;
        await releaseSlot(rows[0].slot_id);
        publish('booking.expired', { ...bookingEvent(rows[0]), reason: 'payment_expired' });
        released++;
    }
    return released;
}

// "payment.refunded" from payment-service (late payment or a refund made in the Stripe Dashboard)
async function onPaymentRefunded({ bookingId }) {
    await Booking.update({ refunded_at: new Date() }, { where: { id: bookingId, refunded_at: null } });
}

// Admin dashboard figures: totals, revenue, top venues and bookings per day for the next 7 days
async function getStats() {
    try {
        const now = new Date();
        const today = new Date(now);
        today.setUTCHours(0, 0, 0, 0);
        const weekAhead = new Date(today.getTime() + 7 * 86400000);
        const booked = { status: 'booked' };

        const [active, cancelled, upcoming, revenue, perVenue, perDay] = await Promise.all([
            Booking.count({ where: booked }),
            Booking.count({ where: { status: 'cancelled' } }),
            Booking.count({ where: { ...booked, start_time: { [Op.gt]: now } } }),
            Booking.sum('price', { where: booked }),
            Booking.findAll({
                where: booked,
                attributes: ['venue_id', [fn('COUNT', col('id')), 'bookings'], [fn('SUM', col('price')), 'revenue']],
                group: ['venue_id'],
                order: [[fn('COUNT', col('id')), 'DESC']],
                limit: 5,
                raw: true,
            }),
            Booking.findAll({
                where: { ...booked, start_time: { [Op.gte]: today, [Op.lt]: weekAhead } },
                // Bucket by UTC day (matches the UTC range above); formatted in SQL so no driver time zone parsing is involved
                attributes: [[fn('to_char', literal("start_time AT TIME ZONE 'UTC'"), 'YYYY-MM-DD'), 'day'], [fn('COUNT', col('id')), 'bookings']],
                group: ['day'],
                raw: true,
            }),
        ]);

        const venuesResponse = await venueRpc.call(VENUE_RPC_QUEUE(), {
            action: 'get_venues_by_ids',
            data: { ids: perVenue.map(v => v.venue_id) },
        });
        const names = new Map((venuesResponse.status === 200 ? venuesResponse.body : []).map(v => [v.id, v.name]));

        // Fill in days without bookings so the chart always has 7 bars
        const counts = new Map(perDay.map(d => [d.day, Number(d.bookings)]));
        const nextDays = Array.from({ length: 7 }, (_, i) => {
            const date = new Date(today.getTime() + i * 86400000).toISOString().slice(0, 10);
            return { date, bookings: counts.get(date) || 0 };
        });

        return {
            status: 200,
            body: {
                activeBookings: active,
                cancelledBookings: cancelled,
                upcomingBookings: upcoming,
                revenue: Number(revenue) || 0,
                topVenues: perVenue.map(v => ({
                    venueId: v.venue_id,
                    name: names.get(v.venue_id) ?? null,
                    bookings: Number(v.bookings),
                    revenue: Number(v.revenue) || 0,
                })),
                nextDays,
            },
        };
    } catch (err) {
        return errorResponse(err, 'Error computing stats');
    }
}

// Day-before reminders: called periodically by the scheduler in consumer.js.
// The conditional UPDATE claims each booking once, even if several instances run.
async function sendDueReminders() {
    const now = new Date();
    const due = await Booking.findAll({
        where: {
            status: 'booked',
            reminder_sent_at: null,
            start_time: { [Op.gt]: now, [Op.lte]: new Date(now.getTime() + DAY) },
        },
        attributes: ['id'],
    });
    let sent = 0;
    for (const { id } of due) {
        const [claimed, rows] = await Booking.update(
            { reminder_sent_at: now },
            { where: { id, reminder_sent_at: null }, returning: true }
        );
        if (claimed) {
            publish('booking.reminder', bookingEvent(rows[0]));
            sent++;
        }
    }
    return sent;
}

module.exports = {
    setEventPublisher,
    sendDueReminders,
    expirePendingBookings,
    onPaymentRefunded,
    payBooking,
    markPaid,
    setVenueRpc,
    createBooking,
    getBookingsByUser,
    cancelBooking,
    getStats,
};
