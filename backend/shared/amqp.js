// Connects to RabbitMQ with retries (the broker may start later than the service).
// amqplib is passed in because shared/ has no node_modules of its own.
async function connectWithRetry(amqp, url, { retries = 10, delayMs = 3000 } = {}) {
    for (let attempt = 1; ; attempt++) {
        try {
            const connection = await amqp.connect(url);
            connection.on('error', (err) => console.error('RabbitMQ connection error:', err.message));
            connection.on('close', () => {
                console.error('RabbitMQ connection closed, exiting');
                process.exit(1);
            });
            return connection;
        } catch (err) {
            if (attempt >= retries) throw err;
            console.warn(`RabbitMQ not available (attempt ${attempt}/${retries}), retrying in ${delayMs}ms...`);
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }
}

module.exports = { connectWithRetry };
