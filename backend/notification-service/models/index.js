const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

// Every email the service produced. Without SMTP this table is the dev mailbox.
const Email = sequelize.define('Email', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    to_email: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    html: { type: DataTypes.TEXT, allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
    type: { type: DataTypes.STRING(40), allowNull: false },
    status: {
        type: DataTypes.STRING(10),
        allowNull: false,
        validate: { isIn: [['sent', 'stored', 'failed']] },
    },
    error: { type: DataTypes.TEXT, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
}, {
    tableName: 'emails',
    timestamps: false,
});

module.exports = { sequelize, Email };
