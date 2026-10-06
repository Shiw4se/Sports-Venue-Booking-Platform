const { DataTypes } = require('sequelize');

// A player's review of a game they actually played (one per booking)
module.exports = (sequelize) => {
    return sequelize.define('Review', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        booking_id: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        venue_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        rating: {
            type: DataTypes.SMALLINT,
            allowNull: false,
            validate: { isInt: true, min: 1, max: 5 },
        },
        comment: {
            type: DataTypes.TEXT,
            allowNull: true,
            validate: { len: { args: [0, 1000], msg: 'Comment must be at most 1000 characters' } },
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        updated_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'reviews',
        timestamps: false,
    });
};
