const express = require('express');
const { proxyRpc, sendRPCRequest } = require('../rabbitmq/rpcClient');
const { RpcTimeoutError } = require('../../shared/rpc');
require('dotenv').config();

const PAYMENT_RPC_QUEUE = process.env.PAYMENT_RPC_QUEUE || 'payment_rpc_queue';

// authenticateUser is applied in app.js
const router = express.Router();

// Called when Stripe sends the player back to the site: confirms the booking if the session is paid
router.get('/verify', proxyRpc(PAYMENT_RPC_QUEUE, (req) => ({
    action: 'verify_session',
    data: { sessionId: req.query.session_id, userId: req.user.id },
})));

// Stripe webhook. Mounted in app.js BEFORE any JSON parser with express.raw(), because Stripe signs
// the exact bytes of the body. The raw body and signature go to payment-service, which holds the secret.
async function stripeWebhook(req, res) {
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ message: 'Raw body required' });
    try {
        const response = await sendRPCRequest(PAYMENT_RPC_QUEUE, {
            action: 'webhook',
            data: { rawBody: req.body.toString('base64'), signature: req.headers['stripe-signature'] },
        });
        res.status(response.status).json(response.body);
    } catch (err) {
        console.error(err);
        // Non-2xx makes Stripe retry later
        res.status(err instanceof RpcTimeoutError ? 504 : 500).json({ message: 'Webhook could not be processed' });
    }
}

module.exports = { router, stripeWebhook };
