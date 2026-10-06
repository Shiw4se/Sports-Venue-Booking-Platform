const express = require('express');
const { proxyRpc, sendRPCRequest, authenticateUser } = require('../rabbitmq/rpcClient');
require('dotenv').config();

const router = express.Router();
const USER_RPC_QUEUE = process.env.USER_RPC_QUEUE;

router.post('/register', proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'register',
    data: req.body,
})));

router.post('/login', proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'login',
    data: req.body,
})));

// Profile: current data from user-service (id, email, name, role, avatar_color, created_at)
router.get('/profile', authenticateUser, (req, res) => {
    res.json(req.user);
});

// Update own name / avatar color; the user id always comes from the token
router.put('/profile', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'update_profile',
    data: { userId: req.user.id, name: req.body.name, avatar_color: req.body.avatar_color },
})));

// Forgot password: always 200 (doesn't reveal whether the email exists); the link arrives by email
router.post('/password/forgot', proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'forgot_password',
    data: { email: req.body.email },
})));

router.post('/password/reset', proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'reset_password',
    data: { token: req.body.token, newPassword: req.body.newPassword },
})));

// Saved ("hearted") venues of the current user
router.get('/favorites', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'list_favorites',
    data: { userId: req.user.id },
})));

router.put('/favorites/:venueId', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'add_favorite',
    data: { userId: req.user.id, venueId: req.params.venueId },
})));

router.delete('/favorites/:venueId', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'remove_favorite',
    data: { userId: req.user.id, venueId: req.params.venueId },
})));

router.put('/password', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'change_password',
    data: { userId: req.user.id, currentPassword: req.body.currentPassword, newPassword: req.body.newPassword },
})));

// Profile photo: the client sends an already resized image as a data URL
router.put('/avatar', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'set_avatar',
    data: { userId: req.user.id, dataUrl: req.body.dataUrl },
})));

router.delete('/avatar', authenticateUser, proxyRpc(USER_RPC_QUEUE, (req) => ({
    action: 'remove_avatar',
    data: { userId: req.user.id },
})));

// Public image endpoint. Versioned URLs (?v=<upload time>) never change, so they are cached for a year.
router.get('/avatar/:id', async (req, res) => {
    try {
        const reply = await sendRPCRequest(USER_RPC_QUEUE, { action: 'get_avatar', data: { userId: req.params.id } });
        if (reply.status !== 200) return res.status(reply.status).json(reply.body);

        res.set('Content-Type', reply.body.mime);
        res.set('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache');
        res.send(Buffer.from(reply.body.data, 'base64'));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Internal error' });
    }
});

module.exports = router;
