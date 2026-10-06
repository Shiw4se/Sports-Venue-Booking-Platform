require('dotenv').config();
const { sequelize } = require('./models');
const { start } = require('./rabbitmq/consumer');

// The schema is created from backend/db/init.sql; here we only check the connection.
sequelize.authenticate()
    .then(() => {
        console.log('Venue Service: DB connected');
        return start();
    })
    .catch((err) => {
        console.error('Venue Service failed to start:', err);
        process.exit(1);
    });
