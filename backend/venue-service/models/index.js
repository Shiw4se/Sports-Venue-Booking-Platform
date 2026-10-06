const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

// Model factories
const VenueModel = require('./venue.model');
const SlotModel = require('./slot.model');
const VenuePhotoModel = require('./venuePhoto.model');

// Initialize models
const Venue = VenueModel(sequelize);
const Slot = SlotModel(sequelize);
const VenuePhoto = VenuePhotoModel(sequelize);

// Associations
Venue.hasMany(Slot, {
    foreignKey: 'venue_id',
    as: 'slots',
    onDelete: 'CASCADE'
});
Slot.belongsTo(Venue, {
    foreignKey: 'venue_id',
    as: 'venue',
    onDelete: 'CASCADE'
});
Venue.hasMany(VenuePhoto, {
    foreignKey: 'venue_id',
    as: 'photos',
    onDelete: 'CASCADE'
});

module.exports = {
    sequelize,
    Venue,
    Slot,
    VenuePhoto
};
