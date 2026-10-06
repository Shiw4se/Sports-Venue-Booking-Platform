// Shared RPC helpers on top of RabbitMQ.
// The module has no dependencies of its own: the amqplib channel is passed in,
// so any service can use it via require('../shared/rpc').
const { randomUUID } = require('crypto');

// RabbitMQ's built-in "direct reply-to" queue: no need to create
// a separate reply queue for every request.
const REPLY_QUEUE = 'amq.rabbitmq.reply-to';

// Declares an RPC queue. Queues are durable: RabbitMQ 4.x forbids
// transient non-exclusive queues (transient_nonexcl_queues).
// Options must be identical in all services, otherwise the broker returns PRECONDITION_FAILED.
function assertRpcQueue(channel, queue) {
    return channel.assertQueue(queue, { durable: true });
}

class RpcTimeoutError extends Error {
    constructor(queue) {
        super(`RPC request to "${queue}" timed out`);
        this.name = 'RpcTimeoutError';
    }
}

// Client: a single reply-to subscription and a map of pending replies by correlationId.
async function createRpcClient(channel, { timeoutMs = 10000 } = {}) {
    const pending = new Map();

    await channel.consume(
        REPLY_QUEUE,
        (msg) => {
            if (!msg) return;
            const entry = pending.get(msg.properties.correlationId);
            if (!entry) return;

            pending.delete(msg.properties.correlationId);
            clearTimeout(entry.timer);

            try {
                entry.resolve(JSON.parse(msg.content.toString()));
            } catch {
                entry.reject(new Error('Failed to parse RPC response'));
            }
        },
        { noAck: true }
    );

    function call(queue, message, { timeoutMs: callTimeoutMs = timeoutMs } = {}) {
        return new Promise((resolve, reject) => {
            const correlationId = randomUUID();
            const timer = setTimeout(() => {
                pending.delete(correlationId);
                reject(new RpcTimeoutError(queue));
            }, callTimeoutMs);

            pending.set(correlationId, { resolve, reject, timer });
            channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
                correlationId,
                replyTo: REPLY_QUEUE,
            });
        });
    }

    return { call };
}

// Server: listens on a queue, dispatches by the action field and always replies
// with { status, body }. Handler errors never crash the consumer.
// Every server also answers the built-in "ping" action (used by the gateway health check).
async function serveRpc(channel, queue, serviceHandlers) {
    const handlers = { ping: async () => ({ status: 200, body: { ok: true } }), ...serviceHandlers };
    await assertRpcQueue(channel, queue);
    await channel.prefetch(10);
    console.log(`[x] Waiting for RPC requests on ${queue}`);

    channel.consume(queue, async (msg) => {
        if (!msg) return;

        let response;
        try {
            const { action, data } = JSON.parse(msg.content.toString());
            const handler = handlers[action];
            response = handler
                ? await handler(data || {})
                : { status: 400, body: { message: 'Unknown action' } };
        } catch (err) {
            console.error(`[RPC ${queue}] handler error:`, err);
            response = { status: 500, body: { message: 'Internal service error' } };
        }

        if (msg.properties.replyTo) {
            channel.sendToQueue(
                msg.properties.replyTo,
                Buffer.from(JSON.stringify(response)),
                { correlationId: msg.properties.correlationId }
            );
        }
        channel.ack(msg);
    });
}

// Turns a Sequelize validation error into a 400 response, anything else into 500.
function errorResponse(err, fallbackMessage) {
    const isValidation = err && (
        err.name === 'SequelizeValidationError'
        || err.name === 'SequelizeUniqueConstraintError'
        // e.g. a malformed UUID in a parameter
        || (err.name === 'SequelizeDatabaseError' && /invalid input syntax/.test(err.message))
    );
    if (isValidation) {
        return {
            status: 400,
            body: { message: err.errors ? err.errors.map(e => e.message).join('; ') : 'Invalid input' },
        };
    }
    console.error(fallbackMessage, err);
    return { status: 500, body: { message: fallbackMessage } };
}

module.exports = { assertRpcQueue, createRpcClient, serveRpc, errorResponse, RpcTimeoutError };
