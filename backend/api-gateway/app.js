const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const { connectRabbitMQ, sendRPCRequest, authenticateUser, authenticateAdmin } = require('./rabbitmq/rpcClient');
const userRoutes = require('./routes/user.routes');
const slotRoutes = require('./routes/slots.routes');
const bookingRoutes = require('./routes/booking.routes');
const adminRoutes = require('./routes/admin.routes');
const { router: paymentRoutes, stripeWebhook } = require('./routes/payments.routes');
const openapi = require('./docs/openapi.json');

dotenv.config();

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    process.exit(1);
}

const app = express();

// Security headers. CSP is off because the React build uses an inline runtime chunk
// and loads Google Fonts; enable and tune it for production deployments.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
// Stripe signs the raw request body, so this route must see it before any JSON parser
app.post('/api/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);
// Avatar uploads carry a base64 image (≤300 KB of bytes); everything else stays small
app.use('/api/user/avatar', express.json({ limit: '600kb' }));
// Venue gallery photos (≤900 KB of bytes)
app.use(/^\/api\/venue\/[^/]+\/photos$/, express.json({ limit: '1300kb' }));
app.use(express.json({ limit: '100kb' }));

// Brute-force protection for login / registration
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_RATE_LIMIT) || 50,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many attempts, please try again later' },
});
app.use(['/api/user/login', '/api/user/register', '/api/user/password/forgot', '/api/user/password/reset'], authLimiter);

// Liveness of the gateway and every service behind RabbitMQ
const SERVICES = {
    user: process.env.USER_RPC_QUEUE,
    venue: process.env.VENUE_RPC_QUEUE,
    booking: process.env.BOOKING_RPC_QUEUE,
    notification: process.env.NOTIFICATION_RPC_QUEUE || 'notification_rpc_queue',
    payment: process.env.PAYMENT_RPC_QUEUE || 'payment_rpc_queue',
};
app.get('/api/health', async (req, res) => {
    const results = await Promise.all(Object.entries(SERVICES).map(async ([name, queue]) => {
        try {
            const reply = await sendRPCRequest(queue, { action: 'ping' }, { timeoutMs: 2000 });
            return [name, reply.status === 200 ? 'up' : 'down'];
        } catch {
            return [name, 'down'];
        }
    }));
    const status = results.every(([, state]) => state === 'up') ? 'ok' : 'degraded';
    res.status(status === 'ok' ? 200 : 503).json({
        status,
        services: Object.fromEntries(results),
        uptimeSeconds: Math.round(process.uptime()),
    });
});

// Interactive API documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'SportBook API' }));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

// API routes (admin checks are applied per route in slots.routes.js)
app.use('/api/user', userRoutes);
app.use('/api/venue', slotRoutes);
app.use('/api/bookings', authenticateUser, bookingRoutes);
app.use('/api/payments', authenticateUser, paymentRoutes);
app.use('/api/admin', authenticateAdmin, adminRoutes);

// 404 for unknown API routes
app.use('/api', (req, res) => {
    res.status(404).json({ message: 'API route not found' });
});

// Malformed or oversized JSON in the request body
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ message: 'Invalid JSON' });
    }
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ message: 'Request body is too large' });
    }
    next(err);
});

// Serve the React frontend build
const FRONTEND_BUILD = path.join(__dirname, '../../frontend/build');
app.use(express.static(FRONTEND_BUILD));

app.get('*', (req, res) => {
    res.sendFile(path.join(FRONTEND_BUILD, 'index.html'));
});

const PORT = process.env.PORT || 3000;

connectRabbitMQ()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`API Gateway running on port ${PORT}`);
            console.log(`API docs: http://localhost:${PORT}/api/docs`);
        });
    })
    .catch((err) => {
        console.error('API Gateway failed to start:', err);
        process.exit(1);
    });
