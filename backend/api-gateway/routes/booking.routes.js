const express = require('express');
const { proxyRpc } = require('../rabbitmq/rpcClient');
require('dotenv').config();

// authenticateUser is applied in app.js, so req.user is already set here
const router = express.Router();
const BOOKING_RPC_QUEUE = process.env.BOOKING_RPC_QUEUE;

// user_id always comes from the token; only slot_id is taken from the body
router.post('/create', proxyRpc(BOOKING_RPC_QUEUE, (req) => ({
    action: 'create',
    data: { userId: req.user.id, slot_id: req.body.slot_id },
})));

// Users can only view their own bookings
router.get('/:userId', (req, res, next) => {
    if (req.params.userId !== req.user.id) {
        return res.status(403).json({ message: 'Forbidden' });
    }
    next();
}, proxyRpc(BOOKING_RPC_QUEUE, (req) => ({
    action: 'get',
    data: { userId: req.user.id },
})));

// Rate a played game: { rating: 1..5, comment? } — creates or updates the review
router.post('/:bookingId/review', proxyRpc(BOOKING_RPC_QUEUE, (req) => ({
    action: 'upsert_review',
    data: { userId: req.user.id, bookingId: req.params.bookingId, rating: req.body.rating, comment: req.body.comment },
})));

// booking-service checks that the booking belongs to the user
router.delete('/:bookingId', proxyRpc(BOOKING_RPC_QUEUE, (req) => ({
    action: 'cancel',
    data: { id: req.params.bookingId, userId: req.user.id },
})));

module.exports = router;
