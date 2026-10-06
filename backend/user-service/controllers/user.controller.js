const crypto = require('crypto');
const User = require('../models/user.model');
const Favorite = require('../models/favorite.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { errorResponse } = require('../../shared/rpc');

const MIN_PASSWORD_LENGTH = 6;
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Domain-event publisher, set from consumer.js on startup
let publish = () => {};
function setEventPublisher(fn) {
    publish = fn;
}

async function register(data) {
    const { name, email, password } = data;
    if (!isNonEmptyString(name) || !isNonEmptyString(email) || typeof password !== 'string') {
        return { status: 400, body: { message: 'name, email and password are required' } };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
        return { status: 400, body: { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ where: { email: normalizedEmail } });
    if (existing) return { status: 400, body: { message: 'Email already exists' } };

    try {
        const hashed = await bcrypt.hash(password, 10);
        // role is intentionally not taken from the request — registration always creates a regular user
        const user = await User.create({ name: name.trim(), email: normalizedEmail, password: hashed });
        publish('user.registered', { userId: user.id, email: user.email, name: user.name });
        return { status: 201, body: { id: user.id, email: user.email } };
    } catch (err) {
        return errorResponse(err, 'Error registering user');
    }
}

async function login(data) {
    const { email, password } = data;
    if (!isNonEmptyString(email) || typeof password !== 'string') {
        return { status: 400, body: { message: 'email and password are required' } };
    }

    const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user) return { status: 401, body: { message: 'Invalid credentials' } };

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return { status: 401, body: { message: 'Invalid credentials' } };

    const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '1d' }
    );

    return { status: 200, body: { token } };
}

async function validateUser(data) {
    if (!data.userId) return { status: 400, body: { message: 'userId is required' } };

    const user = await User.findByPk(data.userId);
    if (!user) return { status: 404, body: { message: 'User not found' } };

    return { status: 200, body: publicProfile(user) };
}

function publicProfile(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_color: user.avatar_color,
        // ?v= changes on every upload, so the image can be cached forever
        avatar_url: user.avatar_updated_at
            ? `/api/user/avatar/${user.id}?v=${new Date(user.avatar_updated_at).getTime()}`
            : null,
        created_at: user.created_at,
    };
}

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_BYTES = 300 * 1024;

// Expects a data URL ("data:image/webp;base64,...") of an already resized image
async function setAvatar({ userId, dataUrl }) {
    const match = typeof dataUrl === 'string' && /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match || !AVATAR_TYPES.includes(match[1])) {
        return { status: 400, body: { message: 'Avatar must be a PNG, JPEG or WebP image' } };
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) return { status: 400, body: { message: 'Avatar image is empty' } };
    if (bytes.length > MAX_AVATAR_BYTES) {
        return { status: 413, body: { message: `Avatar must be at most ${MAX_AVATAR_BYTES / 1024} KB` } };
    }

    const user = await User.findByPk(userId);
    if (!user) return { status: 404, body: { message: 'User not found' } };

    await user.update({ avatar_image: bytes, avatar_mime: match[1], avatar_updated_at: new Date() });
    return { status: 200, body: publicProfile(user) };
}

async function removeAvatar({ userId }) {
    const user = await User.findByPk(userId);
    if (!user) return { status: 404, body: { message: 'User not found' } };

    await user.update({ avatar_image: null, avatar_mime: null, avatar_updated_at: null });
    return { status: 200, body: publicProfile(user) };
}

// Image bytes travel over RPC as base64
async function getAvatar({ userId }) {
    const user = await User.scope('withAvatar').findByPk(userId, { attributes: ['avatar_image', 'avatar_mime'] })
        .catch(() => null); // malformed id
    if (!user || !user.avatar_image) return { status: 404, body: { message: 'No avatar' } };
    return { status: 200, body: { mime: user.avatar_mime, data: user.avatar_image.toString('base64') } };
}

// Name and avatar color; only fields that are present are changed
async function updateProfile({ userId, name, avatar_color: avatarColor }) {
    const user = await User.findByPk(userId);
    if (!user) return { status: 404, body: { message: 'User not found' } };

    const changes = {};
    if (name !== undefined) {
        if (!isNonEmptyString(name) || name.trim().length > 60) {
            return { status: 400, body: { message: 'Name must be 1–60 characters' } };
        }
        changes.name = name.trim();
    }
    if (avatarColor !== undefined) changes.avatar_color = avatarColor || null;

    try {
        await user.update(changes);
        return { status: 200, body: publicProfile(user) };
    } catch (err) {
        return errorResponse(err, 'Error updating profile');
    }
}

async function changePassword({ userId, currentPassword, newPassword }) {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return { status: 400, body: { message: 'currentPassword and newPassword are required' } };
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return { status: 400, body: { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
    }

    const user = await User.findByPk(userId);
    if (!user) return { status: 404, body: { message: 'User not found' } };

    // 400 rather than 401: the session is valid, only the confirmation is wrong
    if (!(await bcrypt.compare(currentPassword, user.password))) {
        return { status: 400, body: { message: 'Current password is incorrect' } };
    }

    await user.update({ password: await bcrypt.hash(newPassword, 10) });
    return { status: 200, body: { message: 'Password changed' } };
}

// ---------- Password reset ----------

const RESET_TTL_MS = 60 * 60 * 1000;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// Always answers 200 so the endpoint can't be used to find out which emails are registered
async function forgotPassword({ email }) {
    const ok = { status: 200, body: { message: 'If this email is registered, a reset link has been sent' } };
    if (!isNonEmptyString(email)) return { status: 400, body: { message: 'email is required' } };

    const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
    if (!user) return ok;

    const token = crypto.randomBytes(32).toString('hex');
    await user.update({ reset_token_hash: sha256(token), reset_token_expires_at: new Date(Date.now() + RESET_TTL_MS) });
    publish('user.password_reset_requested', { userId: user.id, email: user.email, name: user.name, token });
    return ok;
}

async function resetPassword({ token, newPassword }) {
    if (typeof token !== 'string' || typeof newPassword !== 'string') {
        return { status: 400, body: { message: 'token and newPassword are required' } };
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return { status: 400, body: { message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` } };
    }

    const user = await User.findOne({ where: { reset_token_hash: sha256(token) } });
    if (!user || !user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
        return { status: 400, body: { message: 'This reset link is invalid or has expired' } };
    }

    // The token works once
    await user.update({
        password: await bcrypt.hash(newPassword, 10),
        reset_token_hash: null,
        reset_token_expires_at: null,
    });
    return { status: 200, body: { message: 'Password updated, you can log in now' } };
}

// ---------- Favorites ----------

async function listFavorites({ userId }) {
    const rows = await Favorite.findAll({ where: { user_id: userId }, order: [['created_at', 'DESC']] });
    return { status: 200, body: rows.map(r => r.venue_id) };
}

async function addFavorite({ userId, venueId }) {
    if (!UUID_RE.test(venueId || '')) return { status: 400, body: { message: 'Invalid venue id' } };
    try {
        await Favorite.findOrCreate({ where: { user_id: userId, venue_id: venueId } });
        return listFavorites({ userId });
    } catch (err) {
        if (err.name === 'SequelizeForeignKeyConstraintError') return { status: 404, body: { message: 'Venue not found' } };
        return errorResponse(err, 'Error saving favorite');
    }
}

async function removeFavorite({ userId, venueId }) {
    if (!UUID_RE.test(venueId || '')) return { status: 400, body: { message: 'Invalid venue id' } };
    await Favorite.destroy({ where: { user_id: userId, venue_id: venueId } });
    return listFavorites({ userId });
}

// ---------- Public data for other services ----------

// Display name and avatar of review authors (no emails)
async function getPublicUsers({ ids }) {
    const valid = (Array.isArray(ids) ? ids : []).filter(id => UUID_RE.test(id));
    if (valid.length === 0) return { status: 200, body: [] };
    const users = await User.findAll({ where: { id: valid } });
    return {
        status: 200,
        body: users.map(u => {
            const { id, name, avatar_color, avatar_url } = publicProfile(u);
            return { id, name, avatar_color, avatar_url };
        }),
    };
}

module.exports = {
    setEventPublisher,
    register,
    login,
    validateUser,
    updateProfile,
    changePassword,
    setAvatar,
    removeAvatar,
    getAvatar,
    forgotPassword,
    resetPassword,
    listFavorites,
    addFavorite,
    removeFavorite,
    getPublicUsers,
};
