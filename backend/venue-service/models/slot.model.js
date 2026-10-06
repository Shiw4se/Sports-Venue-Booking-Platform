const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define('Slot', {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true
        },
        venue_id: {
            type: DataTypes.UUID,
            allowNull: false
        },
        start_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        end_time: {
            type: DataTypes.DATE,
            allowNull: false,
        },
        is_available: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        }
    }, {
        tableName: 'available_slots',
        timestamps: false,
        validate: {
            endAfterStart() {
                if (this.start_time && this.end_time && new Date(this.end_time) <= new Date(this.start_time)) {
                    throw new Error('end_time must be after start_time');
                }
            },
        },
    });
};
