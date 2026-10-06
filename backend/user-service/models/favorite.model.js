const { DataTypes } = require('sequelize');
const { sequelize } = require('./index');

// A venue the user saved ("heart"); deleted with the user or the venue (FK cascade)
const Favorite = sequelize.define('Favorite', {
    user_id: {
        type: DataTypes.UUID,
        primaryKey: true,
    },
    venue_id: {
        type: DataTypes.UUID,
        primaryKey: true,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'favorites',
    timestamps: false,
});

module.exports = Favorite;
