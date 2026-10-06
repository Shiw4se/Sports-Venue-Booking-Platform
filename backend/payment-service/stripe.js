// The only place that talks to Stripe. Without STRIPE_SECRET_KEY the service answers
// "payments disabled" and bookings are confirmed immediately, exactly as before payments existed.
require('dotenv').config();
const Stripe = require('stripe');

const key = process.env.STRIPE_SECRET_KEY;

// STRIPE_API_BASE points the client at stripe-mock (e.g. http://localhost:12111) for tests without a Stripe account
function clientOptions() {
    if (!process.env.STRIPE_API_BASE) return {};
    const url = new URL(process.env.STRIPE_API_BASE);
    return { host: url.hostname, port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80), protocol: url.protocol.replace(':', '') };
}

const stripe = key ? new Stripe(key, clientOptions()) : null;

module.exports = {
    stripe,
    enabled: Boolean(stripe),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    currency: (process.env.STRIPE_CURRENCY || 'usd').toLowerCase(),
    holdMinutes: Math.max(30, Number(process.env.PAYMENT_HOLD_MINUTES) || 30), // Stripe minimum
    appUrl: (process.env.APP_URL || 'http://localhost:3010').replace(/\/$/, ''),
    timeZone: process.env.APP_TIMEZONE || 'Europe/Kyiv',
};
