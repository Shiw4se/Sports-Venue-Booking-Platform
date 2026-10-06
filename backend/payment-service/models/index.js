const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

const PAYMENT_STATUSES = ['pending', 'paid', 'expired', 'failed', 'refunded', 'refund_failed'];

// One row per booking; stripe_session_id is the latest Checkout Session ("Pay now" may create several)
const Payment = sequelize.define('Payment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    booking_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'usd' },
    stripe_session_id: { type: DataTypes.STRING, allowNull: true, unique: true },
    stripe_payment_intent_id: { type: DataTypes.STRING, allowNull: true },
    status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        validate: { isIn: [PAYMENT_STATUSES] },
    },
    refund_id: { type: DataTypes.STRING, allowNull: true },
}, {
    tableName: 'payments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
});

// Stripe webhook events already processed (Stripe may deliver an event more than once)
const StripeEvent = sequelize.define('StripeEvent', {
    event_id: { type: DataTypes.STRING, primaryKey: true },
    type: { type: DataTypes.STRING(60), allowNull: false },
    received_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: 'stripe_events',
    timestamps: false,
});

module.exports = { sequelize, Payment, StripeEvent, PAYMENT_STATUSES };
