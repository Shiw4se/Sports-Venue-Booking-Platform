require('dotenv').config();
const amqp = require('amqplib');
const { connectWithRetry } = require('../../shared/amqp');
const { serveRpc } = require('../../shared/rpc');
const { createEventPublisher, subscribeEvents } = require('../../shared/events');
const controller = require('../controllers/slot.controller');

async function start() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);

    const eventsChannel = await connection.createChannel();
    controller.setEventPublisher(await createEventPublisher(eventsChannel));
    await subscribeEvents(eventsChannel, process.env.EVENTS_QUEUE || 'venue_service_events', {
        'venue.rating_changed': controller.applyRating,
    });

    const channel = await connection.createChannel();
    await serveRpc(channel, process.env.RPC_QUEUE, {
        create: controller.createVenue,
        update: controller.updateVenue,
        get_all: controller.getAllVenues,
        get_venues_by_ids: controller.getVenuesByIds,
        get_slots_by_venue: controller.getSlotsByVenueId,
        deleteVenue: controller.deleteVenue,
        createSlot: controller.createSlot,
        createSlotsBulk: controller.createSlotsBulk,
        deleteSlot: controller.deleteSlot,
        reserve_slot: controller.reserveSlot,
        release_slot: controller.releaseSlot,
        add_photo: controller.addPhoto,
        delete_photo: controller.deletePhoto,
        get_photo: controller.getPhoto,
    });
}

module.exports = { start };
