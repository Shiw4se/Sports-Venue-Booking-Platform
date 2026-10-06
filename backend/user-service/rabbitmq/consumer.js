require('dotenv').config();
const amqp = require('amqplib');
const { connectWithRetry } = require('../../shared/amqp');
const { serveRpc } = require('../../shared/rpc');
const { createEventPublisher } = require('../../shared/events');
const controller = require('../controllers/user.controller');

async function start() {
    const connection = await connectWithRetry(amqp, process.env.RABBITMQ_URL);

    const eventsChannel = await connection.createChannel();
    controller.setEventPublisher(await createEventPublisher(eventsChannel));

    const channel = await connection.createChannel();
    await serveRpc(channel, process.env.RPC_QUEUE, {
        register: controller.register,
        login: controller.login,
        validate_user: controller.validateUser,
        update_profile: controller.updateProfile,
        change_password: controller.changePassword,
        set_avatar: controller.setAvatar,
        remove_avatar: controller.removeAvatar,
        get_avatar: controller.getAvatar,
        forgot_password: controller.forgotPassword,
        reset_password: controller.resetPassword,
        list_favorites: controller.listFavorites,
        add_favorite: controller.addFavorite,
        remove_favorite: controller.removeFavorite,
        get_public_users: controller.getPublicUsers,
    });
}

module.exports = { start };
