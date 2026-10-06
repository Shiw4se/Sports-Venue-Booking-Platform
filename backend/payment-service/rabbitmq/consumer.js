require('dotenv').config();
const amqp = require('amqplib');
const { connectWithRetry } = require('../../shared/amqp');
const { assertRpcQueue, createRpcClient, serveRpc } = require('../../shared/rpc');
const { createEventPublisher, subscribeEvents } = require('../../shared/events');
const controller = require('../controllers/payment.controller');

async function start() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);

    // Outgoing: confirm bookings in booking-service, look up player emails in user-service
    const clientChannel = await connection.createChannel();
    await assertRpcQueue(clientChannel, process.env.BOOKING_RPC_QUEUE || 'booking_rpc_queue');
    await assertRpcQueue(clientChannel, process.env.USER_RPC_QUEUE || 'user_rpc_queue');
    const rpc = await createRpcClient(clientChannel);

    const eventsChannel = await connection.createChannel();
    const publish = await createEventPublisher(eventsChannel);
    controller.setDeps({ rpc, publish });

    // A released booking (expired hold or cancelled while unpaid) closes its Checkout Session
    await subscribeEvents(eventsChannel, process.env.EVENTS_QUEUE || 'payment_events', {
        'booking.expired': controller.onBookingReleased,
        'booking.cancelled': controller.onBookingReleased,
    });

    const rpcChannel = await connection.createChannel();
    await serveRpc(rpcChannel, process.env.RPC_QUEUE, {
        create_checkout: controller.createCheckout,
        verify_session: controller.verifySession,
        webhook: controller.handleWebhook,
        refund: controller.refund,
        get_by_booking: controller.getByBooking,
    });
}

module.exports = { start };
