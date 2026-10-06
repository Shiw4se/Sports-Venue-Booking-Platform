// Turns domain events into emails. Booking events only carry ids, so the recipient and the
// venue are looked up in user-service / venue-service over RPC.
require('dotenv').config();
const { Email } = require('./models');
const { deliver } = require('./mailer');
const { templates } = require('./templates');
const { errorResponse } = require('../shared/rpc');

let rpc;
const USER_QUEUE = () => process.env.USER_RPC_QUEUE || 'user_rpc_queue';
const VENUE_QUEUE = () => process.env.VENUE_RPC_QUEUE || 'venue_rpc_queue';

function setRpc(client) {
    rpc = client;
}

async function lookupUser(userId) {
    const reply = await rpc.call(USER_QUEUE(), { action: 'validate_user', data: { userId } });
    if (reply.status !== 200) throw new Error(`User ${userId} not found`);
    return reply.body;
}

async function lookupVenue(venueId) {
    const reply = await rpc.call(VENUE_QUEUE(), { action: 'get_venues_by_ids', data: { ids: [venueId] } });
    return (reply.status === 200 && reply.body[0]) || { name: 'Venue', type: null, location: null };
}

async function sendBookingEmail(type, booking) {
    const [user, venue] = await Promise.all([lookupUser(booking.userId), lookupVenue(booking.venueId)]);
    await deliver({ to: user.email, type, ...templates[type]({ user, venue, booking }) });
}

const eventHandlers = {
    'user.registered': (user) =>
        deliver({ to: user.email, type: 'welcome', ...templates.welcome({ user }) }),

    'user.password_reset_requested': ({ email, name, token }) =>
        deliver({ to: email, type: 'password_reset', ...templates.password_reset({ user: { email, name }, token }) }),

    'booking.created': (booking) => sendBookingEmail('booking_confirmed', booking),
    'booking.cancelled': (booking) => sendBookingEmail('booking_cancelled', booking),
    'booking.reminder': (booking) => sendBookingEmail('booking_reminder', booking),
};

// ---------- Mailbox for admins (RPC) ----------

async function listEmails({ limit = 50, offset = 0 }) {
    try {
        const { rows, count } = await Email.findAndCountAll({
            attributes: ['id', 'to_email', 'subject', 'type', 'status', 'created_at'],
            order: [['created_at', 'DESC']],
            limit: Math.min(Number(limit) || 50, 200),
            offset: Number(offset) || 0,
        });
        return { status: 200, body: { total: count, emails: rows } };
    } catch (err) {
        return errorResponse(err, 'Error listing emails');
    }
}

async function getEmail({ id }) {
    try {
        const email = await Email.findByPk(id);
        if (!email) return { status: 404, body: { message: 'Email not found' } };
        return { status: 200, body: email };
    } catch (err) {
        return errorResponse(err, 'Error fetching email');
    }
}

module.exports = { setRpc, eventHandlers, listEmails, getEmail };
