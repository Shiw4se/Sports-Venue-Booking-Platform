const { Op, fn, col, literal } = require('sequelize');
const { Booking, Review } = require('../models');
const { errorResponse } = require('../../shared/rpc');

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

// Creates a booking. userId comes from the token (passed by api-gateway), not from the request body.
async function createBooking({ userId, slot_id: slotId }) {
    if (!userId || !slotId) {
        return { status: 400, body: { message: 'slot_id is required' } };
    }

    // 1. Atomically reserve the slot in venue-service (prevents double booking)
    const reserved = await venueRpc.call(VENUE_RPC_QUEUE(), { action: 'reserve_slot', data: { slotId } });
    if (reserved.status !== 200) return reserved;

    const slot = reserved.body;

    // 2. Create the booking; on failure release the slot (compensation)
    try {
        const booking = await Booking.create({
            user_id: userId,
            venue_id: slot.venue_id,
            slot_id: slot.id,
            start_time: slot.start_time,
            end_time: slot.end_time,
            price: priceFor(slot),
            status: 'booked',
            // Games starting within a day need no separate reminder: the confirmation covers it
            reminder_sent_at: new Date(slot.start_time) - Date.now() < DAY ? new Date() : null,
        });
        publish('booking.created', bookingEvent(booking));
        return { status: 201, body: booking };
    } catch (err) {
        await releaseSlot(slot.id);
        return errorResponse(err, 'Error creating booking');
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

        booking.status = 'cancelled';
        await booking.save();
        await releaseSlot(booking.slot_id);
        publish('booking.cancelled', bookingEvent(booking));

        return { status: 200, body: { message: 'Booking cancelled successfully' } };
    } catch (err) {
        return errorResponse(err, 'Error cancelling booking');
    }
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
    setVenueRpc,
    createBooking,
    getBookingsByUser,
    cancelBooking,
    getStats,
};
