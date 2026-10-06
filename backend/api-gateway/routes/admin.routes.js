const express = require('express');
const { proxyRpc } = require('../rabbitmq/rpcClient');
require('dotenv').config();

// authenticateAdmin is applied in app.js
const router = express.Router();

// Dashboard figures: bookings, revenue, top venues, next 7 days
router.get('/stats', proxyRpc(process.env.BOOKING_RPC_QUEUE, () => ({
    action: 'stats',
})));

// Emails produced by notification-service (the dev mailbox when SMTP is not configured)
const NOTIFICATION_RPC_QUEUE = process.env.NOTIFICATION_RPC_QUEUE || 'notification_rpc_queue';

router.get('/emails', proxyRpc(NOTIFICATION_RPC_QUEUE, (req) => ({
    action: 'list_emails',
    data: { limit: req.query.limit, offset: req.query.offset },
})));

router.get('/emails/:id', proxyRpc(NOTIFICATION_RPC_QUEUE, (req) => ({
    action: 'get_email',
    data: { id: req.params.id },
})));

module.exports = router;
