require('dotenv').config();
const { sequelize } = require('./models');
const { start } = require('./rabbitmq/consumer');

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set');
    process.exit(1);
}

// The schema is created from backend/db/init.sql; here we only check the connection.
sequelize.authenticate()
    .then(() => {
        console.log('User Service: DB connected');
        return start();
    })
    .catch((err) => {
        console.error('User Service failed to start:', err);
        process.exit(1);
    });
