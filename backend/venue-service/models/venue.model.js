const { DataTypes } = require('sequelize');

// Must match the CHECK constraint in backend/db/init.sql
const VENUE_TYPES = ['football_field', 'tennis_court', 'basketball_court'];

// Keys of the amenities a venue can list (labels and icons live in the frontend)
const AMENITIES = [
    'lighting', 'changing_rooms', 'showers', 'parking',
    'equipment_rental', 'cafe', 'seating', 'coaching',
];

module.exports = (sequelize) => {
    return sequelize.define('Venue', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { notEmpty: true },
        },
        location: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { notEmpty: true },
        },
        type: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { isIn: [VENUE_TYPES] },
        },
        description: DataTypes.TEXT,
        price_per_hour: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
            validate: { min: 0 },
        },
        surface: {
            type: DataTypes.STRING(40),
            allowNull: true,
        },
        indoor: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        // Max number of players
        capacity: {
            type: DataTypes.INTEGER,
            allowNull: true,
            validate: { min: 1, max: 100 },
        },
        amenities: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: false,
            defaultValue: [],
            validate: {
                knownAmenities(value) {
                    if (!Array.isArray(value)) throw new Error('amenities must be an array');
                    const unknown = value.filter(a => !AMENITIES.includes(a));
                    if (unknown.length) throw new Error(`Unknown amenities: ${unknown.join(', ')}`);
                },
            },
        },
        // Review aggregate, kept up to date from "venue.rating_changed" events
        rating_avg: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true,
        },
        rating_count: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'venues',
        timestamps: false
    });
};

module.exports.VENUE_TYPES = VENUE_TYPES;
module.exports.AMENITIES = AMENITIES;
