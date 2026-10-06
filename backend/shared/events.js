// Domain events over RabbitMQ: a durable topic exchange that services publish to
// ("booking.created", "user.registered", ...) and subscribe to with their own durable queues.
// Unlike RPC, nobody waits for a reply — e.g. the notification service reacts to bookings
// without the booking service knowing it exists.

// Overridable so a test stack on the same broker does not receive the real stack's events
const EXCHANGE = process.env.EVENTS_EXCHANGE || 'sportbook.events';

async function setupEvents(channel) {
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
}

// Returns publish(type, payload); messages are persistent so they survive a broker restart
async function createEventPublisher(channel) {
    await setupEvents(channel);
    return function publish(type, payload) {
        const event = { type, payload, occurredAt: new Date().toISOString() };
        channel.publish(EXCHANGE, type, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            contentType: 'application/json',
        });
    };
}

// handlers: { 'booking.created': async (payload, event) => {...}, ... }
// A failing handler is logged and the message acknowledged, so one bad event can't block the queue.
async function subscribeEvents(channel, queue, handlers) {
    await setupEvents(channel);
    await channel.assertQueue(queue, { durable: true });
    for (const type of Object.keys(handlers)) {
        await channel.bindQueue(queue, EXCHANGE, type);
    }
    await channel.prefetch(10);
    console.log(`[x] Subscribed ${queue} to: ${Object.keys(handlers).join(', ')}`);

    channel.consume(queue, async (msg) => {
        if (!msg) return;
        try {
            const event = JSON.parse(msg.content.toString());
            await handlers[event.type]?.(event.payload, event);
        } catch (err) {
            console.error(`[events ${queue}] handler error:`, err);
        } finally {
            channel.ack(msg);
        }
    });
}

module.exports = { EXCHANGE, createEventPublisher, subscribeEvents };
