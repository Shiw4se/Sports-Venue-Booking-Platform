const { DataTypes } = require('sequelize');

const BOOKING_STATUSES = ['booked', 'cancelled'];

module.exports = (sequelize) => {
    return sequelize.define('Booking', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        venue_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        slot_id: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        end_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'booked',
            validate: { isIn: [BOOKING_STATUSES] },
        },
        // Set when the day-before reminder was sent (or not needed)
        reminder_sent_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW
        }
    }, {
        tableName: 'bookings',
        timestamps: false,
    });
};
