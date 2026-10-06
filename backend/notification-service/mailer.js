// Delivers emails via SMTP when SMTP_URL is set (Resend, SendGrid, Mailtrap, ... all offer SMTP);
// every email is also saved to the "emails" table, which works as a dev mailbox without SMTP.
require('dotenv').config();
const nodemailer = require('nodemailer');
const { Email } = require('./models');

const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
const FROM = process.env.MAIL_FROM || 'SportBook <no-reply@sportbook.dev>';

async function deliver({ to, type, subject, html, text }) {
    let status = 'stored';
    let error = null;

    if (transport) {
        try {
            await transport.sendMail({ from: FROM, to, subject, html, text });
            status = 'sent';
        } catch (err) {
            status = 'failed';
            error = err.message;
            console.error(`Failed to send "${subject}" to ${to}:`, err.message);
        }
    }

    await Email.create({ to_email: to, type, subject, html, text, status, error });
    console.log(`[mail:${status}] ${type} → ${to}`);
}

module.exports = { deliver, smtpEnabled: Boolean(transport) };
