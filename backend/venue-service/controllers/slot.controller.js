const { Op } = require('sequelize');
const { Venue, Slot, VenuePhoto } = require('../models');
const { errorResponse } = require('../../shared/rpc');

const VENUE_FIELDS = ['name', 'location', 'type', 'description', 'price_per_hour', 'surface', 'indoor', 'capacity', 'amenities'];
const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

// Domain-event publisher, set from consumer.js on startup
let publish = () => {};
function setEventPublisher(fn) {
    publish = fn;
}

const PHOTOS = { model: VenuePhoto, as: 'photos', attributes: ['id', 'position'] };

// Venue as the API returns it: photo bytes are served separately, only ids are listed
function serializeVenue(venue) {
    const { photos, ...rest } = venue.toJSON();
    return {
        ...rest,
        photo_ids: (photos || []).sort((a, b) => a.position - b.position).map(p => p.id),
    };
}

const findVenue = (id) => Venue.findByPk(id, { include: PHOTOS });

// Create a venue
async function createVenue(data) {
    try {
        const venue = await Venue.create(pick(data, VENUE_FIELDS));
        return { status: 201, body: serializeVenue(await findVenue(venue.id)) };
    } catch (err) {
        return errorResponse(err, 'Error creating venue');
    }
}

// Update a venue
async function updateVenue(data) {
    try {
        const venue = await Venue.findByPk(data.id);
        if (!venue) return { status: 404, body: { message: 'Venue not found' } };

        await venue.update(pick(data, VENUE_FIELDS));
        return { status: 200, body: serializeVenue(await findVenue(venue.id)) };
    } catch (err) {
        return errorResponse(err, 'Error updating venue');
    }
}

// List all venues
async function getAllVenues() {
    try {
        const venues = await Venue.findAll({ include: PHOTOS, order: [['created_at', 'ASC']] });
        return { status: 200, body: venues.map(serializeVenue) };
    } catch (err) {
        return errorResponse(err, 'Error fetching venues');
    }
}

// Venue summaries by a list of ids (for booking-service)
async function getVenuesByIds(data) {
    const ids = Array.isArray(data.ids) ? data.ids : [];
    if (ids.length === 0) return { status: 200, body: [] };
    try {
        const venues = await Venue.findAll({ where: { id: ids }, attributes: ['id', 'name', 'type', 'location'] });
        return { status: 200, body: venues };
    } catch (err) {
        return errorResponse(err, 'Error fetching venues');
    }
}

async function deleteVenue(data) {
    try {
        const deleted = await Venue.destroy({ where: { id: data.id } });
        if (!deleted) return { status: 404, body: { message: 'Venue not found' } };
        publish('venue.deleted', { venueId: data.id });
        return { status: 200, body: { message: 'Venue deleted' } };
    } catch (err) {
        return errorResponse(err, 'Error deleting venue');
    }
}

// List a venue's slots
async function getSlotsByVenueId(data) {
    if (!data.id) {
        return { status: 400, body: { message: 'Venue ID is required' } };
    }
    try {
        const slots = await Slot.findAll({
            where: { venue_id: data.id },
            include: { model: Venue, as: 'venue' },
            order: [['start_time', 'ASC']],
        });
        return { status: 200, body: slots };
    } catch (err) {
        return errorResponse(err, 'Error fetching slots');
    }
}

// Existing slots of a venue that overlap [start, end)
const overlapping = (venueId, start, end) => Slot.findAll({
    where: { venue_id: venueId, start_time: { [Op.lt]: end }, end_time: { [Op.gt]: start } },
    attributes: ['start_time', 'end_time'],
});

async function createSlot(data) {
    try {
        const venue = await Venue.findByPk(data.venue_id);
        if (!venue) return { status: 404, body: { message: 'Venue not found' } };

        const slot = Slot.build(pick(data, ['venue_id', 'start_time', 'end_time']));
        await slot.validate();
        if ((await overlapping(slot.venue_id, slot.start_time, slot.end_time)).length) {
            return { status: 409, body: { message: 'This time overlaps an existing slot' } };
        }
        await slot.save();
        return { status: 201, body: slot };
    } catch (err) {
        return errorResponse(err, 'Error creating slot');
    }
}

const MAX_BULK_SLOTS = 500;

// Many slots at once (the admin UI expands "every weekday 18:00–22:00 for 4 weeks" into a list).
// Slots in the past or overlapping existing slots / each other are skipped instead of failing the batch.
async function createSlotsBulk(data) {
    const items = Array.isArray(data.slots) ? data.slots : [];
    if (items.length === 0) return { status: 400, body: { message: 'slots must be a non-empty array' } };
    if (items.length > MAX_BULK_SLOTS) return { status: 400, body: { message: `At most ${MAX_BULK_SLOTS} slots per request` } };

    try {
        const venue = await Venue.findByPk(data.venue_id);
        if (!venue) return { status: 404, body: { message: 'Venue not found' } };

        const now = new Date();
        const candidates = items
            .map(s => ({ start: new Date(s.start_time), end: new Date(s.end_time) }))
            .filter(s => !Number.isNaN(s.start.getTime()) && !Number.isNaN(s.end.getTime()) && s.end > s.start && s.start > now)
            .sort((a, b) => a.start - b.start);
        if (candidates.length === 0) return { status: 400, body: { message: 'No valid future slots in the request' } };

        const lastEnd = new Date(Math.max(...candidates.map(s => s.end.getTime())));
        const taken = (await overlapping(venue.id, candidates[0].start, lastEnd))
            .map(s => ({ start: new Date(s.start_time), end: new Date(s.end_time) }));
        const accepted = [];
        for (const s of candidates) {
            const clash = [...taken, ...accepted].some(o => s.start < o.end && s.end > o.start);
            if (!clash) accepted.push(s);
        }

        const created = accepted.length
            ? await Slot.bulkCreate(accepted.map(s => ({ venue_id: venue.id, start_time: s.start, end_time: s.end })))
            : [];
        return { status: 201, body: { created: created.length, skipped: items.length - created.length } };
    } catch (err) {
        return errorResponse(err, 'Error creating slots');
    }
}

async function deleteSlot(data) {
    try {
        const deleted = await Slot.destroy({ where: { id: data.id } });
        if (!deleted) return { status: 404, body: { message: 'Slot not found' } };
        return { status: 200, body: { message: 'Slot deleted' } };
    } catch (err) {
        return errorResponse(err, 'Error deleting slot');
    }
}

// Atomic slot reservation: among concurrent requests the UPDATE succeeds for only one.
async function reserveSlot(data) {
    try {
        const [count] = await Slot.update(
            { is_available: false },
            { where: { id: data.slotId, is_available: true, start_time: { [Op.gt]: new Date() } } }
        );
        // venue is included so booking-service can price the booking
        const slot = await Slot.findByPk(data.slotId, {
            include: { model: Venue, as: 'venue', attributes: ['id', 'name', 'price_per_hour'] },
        });

        if (count === 0) {
            return slot
                ? { status: 409, body: { message: 'Slot is not available' } }
                : { status: 404, body: { message: 'Slot not found' } };
        }
        return { status: 200, body: slot };
    } catch (err) {
        return errorResponse(err, 'Error reserving slot');
    }
}

async function releaseSlot(data) {
    try {
        await Slot.update({ is_available: true }, { where: { id: data.slotId } });
        return { status: 200, body: { message: 'Slot released' } };
    } catch (err) {
        return errorResponse(err, 'Error releasing slot');
    }
}

const PHOTO_TYPES = ['image/jpeg', 'image/webp', 'image/png'];
const MAX_PHOTO_BYTES = 900 * 1024;
const MAX_PHOTOS = 8;

async function addPhoto({ venueId, dataUrl }) {
    const match = typeof dataUrl === 'string' && /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match || !PHOTO_TYPES.includes(match[1])) {
        return { status: 400, body: { message: 'Photo must be a JPEG, WebP or PNG image' } };
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length === 0) return { status: 400, body: { message: 'Photo is empty' } };
    if (bytes.length > MAX_PHOTO_BYTES) return { status: 413, body: { message: 'Photo must be at most 900 KB' } };

    try {
        const venue = await Venue.findByPk(venueId);
        if (!venue) return { status: 404, body: { message: 'Venue not found' } };
        const count = await VenuePhoto.count({ where: { venue_id: venueId } });
        if (count >= MAX_PHOTOS) return { status: 409, body: { message: `A venue can have at most ${MAX_PHOTOS} photos` } };

        await VenuePhoto.create({ venue_id: venueId, image: bytes, mime: match[1], position: count });
        return { status: 201, body: serializeVenue(await findVenue(venueId)) };
    } catch (err) {
        return errorResponse(err, 'Error saving photo');
    }
}

async function deletePhoto({ photoId }) {
    try {
        const photo = await VenuePhoto.findByPk(photoId);
        if (!photo) return { status: 404, body: { message: 'Photo not found' } };
        await photo.destroy();
        return { status: 200, body: serializeVenue(await findVenue(photo.venue_id)) };
    } catch (err) {
        return errorResponse(err, 'Error deleting photo');
    }
}

// Bytes travel over RPC as base64
async function getPhoto({ photoId }) {
    const photo = await VenuePhoto.scope('withImage').findByPk(photoId).catch(() => null);
    if (!photo) return { status: 404, body: { message: 'Photo not found' } };
    return { status: 200, body: { mime: photo.mime, data: photo.image.toString('base64') } };
}

// "venue.rating_changed" event from booking-service
async function applyRating({ venueId, average, count }) {
    await Venue.update({ rating_avg: count ? average : null, rating_count: count }, { where: { id: venueId } });
}

module.exports = {
    setEventPublisher,
    createSlotsBulk,
    addPhoto,
    deletePhoto,
    getPhoto,
    applyRating,
    createVenue,
    updateVenue,
    getAllVenues,
    getVenuesByIds,
    getSlotsByVenueId,
    deleteVenue,
    createSlot,
    deleteSlot,
    reserveSlot,
    releaseSlot,
};
