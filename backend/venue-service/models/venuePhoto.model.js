const { DataTypes } = require('sequelize');

// Venue gallery image (resized by the admin's browser before upload)
module.exports = (sequelize) => {
    return sequelize.define('VenuePhoto', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        venue_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        image: {
            type: DataTypes.BLOB,
            allowNull: false,
        },
        mime: {
            type: DataTypes.STRING(20),
            allowNull: false,
        },
        position: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'venue_photos',
        timestamps: false,
        // Only the photo endpoint needs the bytes
        defaultScope: { attributes: { exclude: ['image'] } },
        scopes: { withImage: {} },
    });
};
