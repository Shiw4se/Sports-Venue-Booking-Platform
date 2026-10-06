const { fn, col } = require('sequelize');
const { Booking, Review } = require('../models');
const { errorResponse } = require('../../shared/rpc');

// Set from consumer.js on startup
let userRpc;
let publish = () => {};
const USER_RPC_QUEUE = () => process.env.USER_RPC_QUEUE || 'user_rpc_queue';

function setReviewDeps({ userRpc: rpc, publish: pub }) {
    userRpc = rpc;
    publish = pub;
}

// Recomputes the venue's average and tells venue-service (which shows it on cards)
async function publishVenueRating(venueId) {
    const [row] = await Review.findAll({
        where: { venue_id: venueId },
        attributes: [[fn('AVG', col('rating')), 'average'], [fn('COUNT', col('id')), 'count']],
        raw: true,
    });
    const count = Number(row?.count) || 0;
    publish('venue.rating_changed', {
        venueId,
        average: count ? Math.round(Number(row.average) * 100) / 100 : null,
        count,
    });
}

// Create or update the review of a played booking (owner only)
async function upsertReview({ userId, bookingId, rating, comment }) {
    const stars = Number(rating);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return { status: 400, body: { message: 'Rating must be a whole number from 1 to 5' } };
    }
    const text = typeof comment === 'string' ? comment.trim() : '';
    if (text.length > 1000) return { status: 400, body: { message: 'Comment must be at most 1000 characters' } };

    try {
        const booking = await Booking.findByPk(bookingId);
        if (!booking || booking.user_id !== userId) return { status: 404, body: { message: 'Booking not found' } };
        if (booking.status !== 'booked' || new Date(booking.end_time) > new Date()) {
            return { status: 409, body: { message: 'You can review a game after you have played it' } };
        }

        const existing = await Review.findOne({ where: { booking_id: booking.id } });
        const review = existing
            ? await existing.update({ rating: stars, comment: text || null, updated_at: new Date() })
            : await Review.create({
                booking_id: booking.id, user_id: userId, venue_id: booking.venue_id, rating: stars, comment: text || null,
            });

        await publishVenueRating(booking.venue_id);
        return { status: existing ? 200 : 201, body: review };
    } catch (err) {
        return errorResponse(err, 'Error saving review');
    }
}

// Public: rating summary, star distribution and the latest reviews with author name/avatar
async function getVenueReviews({ venueId, limit = 20 }) {
    try {
        const [ratings, latest] = await Promise.all([
            Review.findAll({ where: { venue_id: venueId }, attributes: ['rating'], raw: true }),
            Review.findAll({
                where: { venue_id: venueId },
                order: [['created_at', 'DESC']],
                limit: Math.min(Number(limit) || 20, 50),
            }),
        ]);

        const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        ratings.forEach(r => { distribution[r.rating]++; });
        const count = ratings.length;
        const average = count ? Math.round((ratings.reduce((s, r) => s + r.rating, 0) / count) * 100) / 100 : null;

        let authors = new Map();
        if (latest.length) {
            const reply = await userRpc.call(USER_RPC_QUEUE(), {
                action: 'get_public_users',
                data: { ids: [...new Set(latest.map(r => r.user_id))] },
            }).catch(() => null);
            authors = new Map((reply?.status === 200 ? reply.body : []).map(u => [u.id, u]));
        }

        return {
            status: 200,
            body: {
                average,
                count,
                distribution,
                reviews: latest.map(r => ({
                    id: r.id,
                    rating: r.rating,
                    comment: r.comment,
                    created_at: r.created_at,
                    author: authors.get(r.user_id) || { name: 'Former player', avatar_url: null, avatar_color: null },
                })),
            },
        };
    } catch (err) {
        return errorResponse(err, 'Error fetching reviews');
    }
}

module.exports = { setReviewDeps, upsertReview, getVenueReviews };
