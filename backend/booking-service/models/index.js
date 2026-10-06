const { Sequelize } = require('sequelize');
require('dotenv').config();

// Database connection
const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

// The service only uses its own tables; venue/slot data
// comes from venue-service via RPC.
const Booking = require('./booking.model')(sequelize);
const Review = require('./review.model')(sequelize);

Booking.hasOne(Review, { foreignKey: 'booking_id', as: 'review' });

module.exports = {
    sequelize,
    Booking,
    Review
};
