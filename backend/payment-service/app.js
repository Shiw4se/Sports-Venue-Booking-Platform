require('dotenv').config();
const { sequelize } = require('./models');
const { start } = require('./rabbitmq/consumer');
const { enabled, webhookSecret } = require('./stripe');

// The schema is created from backend/db/init.sql; here we only check the connection.
sequelize.authenticate()
    .then(() => {
        const mode = enabled
            ? `Stripe enabled${webhookSecret ? '' : ' (no STRIPE_WEBHOOK_SECRET — payments are confirmed only when the player returns to the site)'}`
            : 'STRIPE_SECRET_KEY not set — payments disabled, bookings are confirmed immediately';
        console.log(`Payment Service: DB connected, ${mode}`);
        return start();
    })
    .catch((err) => {
        console.error('Payment Service failed to start:', err);
        process.exit(1);
    });
