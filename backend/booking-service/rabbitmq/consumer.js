require('dotenv').config();
const amqp = require('amqplib');
const { connectWithRetry } = require('../../shared/amqp');
const { assertRpcQueue, serveRpc, createRpcClient } = require('../../shared/rpc');
const { createEventPublisher } = require('../../shared/events');
const bookings = require('../controllers/booking.controller');
const reviews = require('../controllers/review.controller');

const REMINDER_INTERVAL_MS = Number(process.env.REMINDER_INTERVAL_MS) || 5 * 60 * 1000;

async function start() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);

    // Separate channel for outgoing requests to venue-service and user-service
    const clientChannel = await connection.createChannel();
    await assertRpcQueue(clientChannel, process.env.VENUE_RPC_QUEUE);
    await assertRpcQueue(clientChannel, process.env.USER_RPC_QUEUE || 'user_rpc_queue');
    const rpc = await createRpcClient(clientChannel);
    bookings.setVenueRpc(rpc);

    const eventsChannel = await connection.createChannel();
    const publish = await createEventPublisher(eventsChannel);
    bookings.setEventPublisher(publish);
    reviews.setReviewDeps({ userRpc: rpc, publish });

    const serverChannel = await connection.createChannel();
    await serveRpc(serverChannel, process.env.RPC_QUEUE, {
        create: bookings.createBooking,
        get: bookings.getBookingsByUser,
        cancel: bookings.cancelBooking,
        stats: bookings.getStats,
        upsert_review: reviews.upsertReview,
        venue_reviews: reviews.getVenueReviews,
    });

    // Day-before reminders
    const runReminders = () => bookings.sendDueReminders()
        .then(n => n && console.log(`Queued ${n} reminder(s)`))
        .catch(err => console.error('Reminder job failed:', err));
    // The first run waits a little: on a fresh broker the notification queue may not exist yet,
    // and events published to an exchange with no bound queue are dropped. Once created, the
    // queue is durable and keeps events even while notification-service is down.
    setTimeout(() => {
        runReminders();
        setInterval(runReminders, REMINDER_INTERVAL_MS);
    }, Number(process.env.REMINDER_START_DELAY_MS ?? 30000));
}

module.exports = { start };
