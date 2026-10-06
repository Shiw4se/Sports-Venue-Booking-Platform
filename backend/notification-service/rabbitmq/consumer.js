require('dotenv').config();
const amqp = require('amqplib');
const { connectWithRetry } = require('../../shared/amqp');
const { assertRpcQueue, createRpcClient, serveRpc } = require('../../shared/rpc');
const { subscribeEvents } = require('../../shared/events');
const handlers = require('../handlers');

async function start() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);

    // Outgoing lookups (recipient, venue)
    const clientChannel = await connection.createChannel();
    await assertRpcQueue(clientChannel, process.env.USER_RPC_QUEUE || 'user_rpc_queue');
    await assertRpcQueue(clientChannel, process.env.VENUE_RPC_QUEUE || 'venue_rpc_queue');
    handlers.setRpc(await createRpcClient(clientChannel));

    // Incoming domain events → emails
    const eventsChannel = await connection.createChannel();
    await subscribeEvents(eventsChannel, process.env.EVENTS_QUEUE || 'notification_events', handlers.eventHandlers);

    // Mailbox API for the admin UI
    const rpcChannel = await connection.createChannel();
    await serveRpc(rpcChannel, process.env.RPC_QUEUE, {
        list_emails: handlers.listEmails,
        get_email: handlers.getEmail,
    });
}

module.exports = { start };
