// Pretend to be Stripe for a pending booking: sends a signed `checkout.session.completed`
// webhook to the gateway, exactly as Stripe would after a successful Checkout.
// For local testing with stripe-mock, which cannot host the Checkout page.
//
//   npm run stripe:pay            -> pays the most recent pending booking
//   npm run stripe:pay -- <id>    -> pays that booking (id or id prefix)
'use strict';
const path = require('path');
const { createRequire } = require('module');

const userServiceRequire = createRequire(path.join(__dirname, '../user-service/package.json'));
const paymentServiceRequire = createRequire(path.join(__dirname, '../payment-service/package.json'));
userServiceRequire('dotenv').config({ path: path.join(__dirname, '../payment-service/.env') });
const { Client } = userServiceRequire('pg');
const Stripe = paymentServiceRequire('stripe');

const API = process.env.E2E_API_URL || 'http://localhost:3000/api';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test';

async function main() {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
        const prefix = process.argv[2];
        const { rows: [payment] } = await db.query(
            `SELECT p.booking_id, p.stripe_session_id, p.amount, p.status AS payment_status, b.status AS booking_status
               FROM payments p JOIN bookings b ON b.id = p.booking_id
              WHERE ($1::text IS NULL OR p.booking_id::text LIKE $1 || '%')
              ORDER BY p.created_at DESC LIMIT 1`, [prefix || null]);
        if (!payment) throw new Error(prefix ? `No payment for booking ${prefix}` : 'No bookings awaiting payment');
        if (payment.booking_status !== 'pending_payment') {
            throw new Error(`Booking ${payment.booking_id} is ${payment.booking_status} (payment ${payment.payment_status}), nothing to pay`);
        }

        const short = payment.booking_id.slice(0, 8);
        const payload = JSON.stringify({
            id: `evt_sim_${Date.now()}_${short}`, object: 'event', type: 'checkout.session.completed',
            created: Math.floor(Date.now() / 1000),
            data: { object: {
                id: payment.stripe_session_id, object: 'checkout.session', status: 'complete', payment_status: 'paid',
                amount_total: Math.round(Number(payment.amount) * 100), payment_intent: `pi_sim_${short}`,
                client_reference_id: payment.booking_id, metadata: { bookingId: payment.booking_id },
            } },
        });
        const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
        const res = await fetch(`${API}/payments/webhook`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': signature }, body: payload,
        });
        const body = await res.json().catch(() => null);
        if (res.status !== 200) throw new Error(`Webhook rejected: ${res.status} ${JSON.stringify(body)}`);

        const { rows: [booking] } = await db.query('SELECT status, paid_at FROM bookings WHERE id = $1', [payment.booking_id]);
        console.log(`Booking ${payment.booking_id}: $${payment.amount} paid -> ${booking.status}`);
    } finally {
        await db.end();
    }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
