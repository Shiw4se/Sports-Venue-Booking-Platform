const { DataTypes } = require('sequelize');
const { sequelize } = require('./index');

const ROLES = ['admin', 'user'];

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: DataTypes.STRING,
    email: {
        type: DataTypes.STRING,
        unique: true,
        validate: { isEmail: true },
    },
    password: DataTypes.STRING,
    // varchar + CHECK in the database (see backend/db/init.sql)
    role: {
        type: DataTypes.STRING,
        defaultValue: 'user',
        validate: { isIn: [ROLES] },
    },
    avatar_color: {
        type: DataTypes.STRING(7),
        allowNull: true,
        validate: { is: { args: /^#[0-9a-f]{6}$/i, msg: 'avatar_color must be a hex color like #0d9488' } },
    },
    // Uploaded profile photo (already resized by the client); loaded only on demand
    avatar_image: {
        type: DataTypes.BLOB,
        allowNull: true,
    },
    avatar_mime: {
        type: DataTypes.STRING(20),
        allowNull: true,
    },
    avatar_updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    // Password reset: SHA-256 of the emailed token, never the token itself
    reset_token_hash: {
        type: DataTypes.STRING(64),
        allowNull: true,
    },
    reset_token_expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'users',
    timestamps: false,
    // The image bytes are never needed for auth/profile lookups
    defaultScope: { attributes: { exclude: ['avatar_image'] } },
    scopes: { withAvatar: {} },
});

module.exports = User;
