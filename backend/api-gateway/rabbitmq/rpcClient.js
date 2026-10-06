require('dotenv').config();
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');
const { connectWithRetry } = require('../../shared/amqp');
const { assertRpcQueue, createRpcClient, RpcTimeoutError } = require('../../shared/rpc');

let rpc;

async function connectRabbitMQ() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);
    const channel = await connection.createChannel();

    // Declare queues up front so requests are not lost if a service has not started yet
    for (const queue of [process.env.USER_RPC_QUEUE, process.env.VENUE_RPC_QUEUE, process.env.BOOKING_RPC_QUEUE, process.env.NOTIFICATION_RPC_QUEUE || 'notification_rpc_queue']) {
        await assertRpcQueue(channel, queue);
    }

    rpc = await createRpcClient(channel, { timeoutMs: Number(process.env.RPC_TIMEOUT_MS) || 10000 });
    console.log('Connected to RabbitMQ');
}

function sendRPCRequest(queue, message, options) {
    return rpc.call(queue, message, options);
}

// Route helper: sends an RPC request and returns its { status, body } to the client
function proxyRpc(queue, buildMessage) {
    return async (req, res) => {
        try {
            const response = await sendRPCRequest(queue, buildMessage(req));
            res.status(response.status).json(response.body);
        } catch (err) {
            console.error(err);
            if (err instanceof RpcTimeoutError) {
                return res.status(504).json({ message: 'Service unavailable' });
            }
            res.status(500).json({ message: 'Internal error' });
        }
    };
}

// Verifies the JWT, loads the current user from user-service
// and (optionally) checks their role.
function authenticate(allowedRoles) {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: No token provided' });
        }

        let decoded;
        try {
            decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        } catch {
            return res.status(401).json({ message: 'Unauthorized: Invalid token' });
        }

        try {
            const response = await sendRPCRequest(process.env.USER_RPC_QUEUE, {
                action: 'validate_user',
                data: { userId: decoded.id },
            });
            if (response.status !== 200) {
                return res.status(401).json({ message: 'Unauthorized: User not found' });
            }

            const user = response.body;
            if (allowedRoles && !allowedRoles.includes(user.role)) {
                return res.status(403).json({ message: 'Forbidden' });
            }

            req.user = user;
            next();
        } catch (err) {
            console.error('Auth RPC error:', err);
            return res.status(503).json({ message: 'Auth service unavailable' });
        }
    };
}

const authenticateUser = authenticate(); // any authenticated user
const authenticateAdmin = authenticate(['admin']);

module.exports = { connectRabbitMQ, sendRPCRequest, proxyRpc, authenticateUser, authenticateAdmin };
