require('dotenv').config();
const express = require('express');
const { proxyRpc, sendRPCRequest, authenticateAdmin } = require('../rabbitmq/rpcClient');

const router = express.Router();
const VENUE_RPC_QUEUE = process.env.VENUE_RPC_QUEUE;

// Public routes
router.get('/get_all', proxyRpc(VENUE_RPC_QUEUE, () => ({
    action: 'get_all',
})));

router.get('/find_by_id/:id', proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'get_slots_by_venue',
    data: { id: req.params.id },
})));

// Reviews and rating summary (served by booking-service, which knows who actually played)
router.get('/:id/reviews', proxyRpc(process.env.BOOKING_RPC_QUEUE, (req) => ({
    action: 'venue_reviews',
    data: { venueId: req.params.id, limit: req.query.limit },
})));

// Gallery image; a photo never changes, so it can be cached for a year
router.get('/photos/:photoId', async (req, res) => {
    try {
        const reply = await sendRPCRequest(VENUE_RPC_QUEUE, { action: 'get_photo', data: { photoId: req.params.photoId } });
        if (reply.status !== 200) return res.status(reply.status).json(reply.body);
        res.set('Content-Type', reply.body.mime);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(Buffer.from(reply.body.data, 'base64'));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal error' });
    }
});

// Admin routes

// Create a venue
router.post('/create', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'create',
    data: req.body,
})));

// Update a venue
router.put('/update/:id', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'update',
    data: { ...req.body, id: req.params.id },
})));

// Create a slot: venue_id in the path (/createslot/:venueId) or in the body
router.post('/createslot/:venueId?', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'createSlot',
    data: { ...req.body, venue_id: req.params.venueId || req.body.venue_id },
})));

// Create many slots at once: { slots: [{ start_time, end_time }, ...] } (overlaps are skipped)
router.post('/createslots/:venueId', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'createSlotsBulk',
    data: { venue_id: req.params.venueId, slots: req.body.slots },
})));

// Upload a gallery photo: { dataUrl } (resized by the browser)
router.post('/:id/photos', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'add_photo',
    data: { venueId: req.params.id, dataUrl: req.body.dataUrl },
})));

router.delete('/photos/:photoId', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'delete_photo',
    data: { photoId: req.params.photoId },
})));

// Delete a venue
router.delete('/delete/:id', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'deleteVenue',
    data: { id: req.params.id },
})));

// Delete a slot
router.delete('/deleteslot/:id', authenticateAdmin, proxyRpc(VENUE_RPC_QUEUE, (req) => ({
    action: 'deleteSlot',
    data: { id: req.params.id },
})));

module.exports = router;
