require('dotenv').config();
const { sequelize } = require('./models');
const { start } = require('./rabbitmq/consumer');
const { smtpEnabled } = require('./mailer');

// The schema is created from backend/db/init.sql; here we only check the connection.
sequelize.authenticate()
    .then(() => {
        console.log(`Notification Service: DB connected, ${smtpEnabled ? 'sending via SMTP' : 'SMTP not configured — emails go to the dev mailbox'}`);
        return start();
    })
    .catch((err) => {
        console.error('Notification Service failed to start:', err);
        process.exit(1);
    });
