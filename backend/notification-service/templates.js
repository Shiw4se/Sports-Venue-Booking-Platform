// Email templates: table-based HTML with inline styles (what email clients understand) + a plain-text part.
require('dotenv').config();

const APP_URL = () => (process.env.APP_URL || 'http://localhost:3010').replace(/\/$/, '');
const TIME_ZONE = () => process.env.APP_TIMEZONE || 'Europe/Kyiv';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const SPORT = { football_field: '⚽ Football', tennis_court: '🎾 Tennis', basketball_court: '🏀 Basketball' };

function formatWhen(start, end) {
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TIME_ZONE() });
    const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE() });
    return `${day.format(new Date(start))}, ${time.format(new Date(start))}–${time.format(new Date(end))}`;
}

// "today" / "tomorrow" in the app time zone (reminders go out up to 24 hours ahead)
function relativeDay(date) {
    const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE() }).format(d);
    return dayKey(new Date(date)) === dayKey(new Date()) ? 'today' : 'tomorrow';
}

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);

function layout({ preheader, heading, intro, details = [], button, footnote }) {
    const rows = details.map(([label, value]) => `
        <tr>
          <td style="padding:6px 0;color:#64748b;font-size:14px;width:96px;vertical-align:top">${escapeHtml(label)}</td>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:600">${escapeHtml(value)}</td>
        </tr>`).join('');

    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
        <tr><td style="padding:0 4px 16px;font-size:18px;font-weight:800;color:#0f172a">
          <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#0f766e;color:#fff;font-size:15px;margin-right:8px">S</span>SportBook
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:16px;padding:28px;border:1px solid #e2e8f0">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#334155">${intro}</p>
          ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;padding:12px 16px;background:#f8fafc;border-radius:12px">${rows}</table>` : ''}
          ${button ? `<a href="${escapeHtml(button.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#0f766e;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none">${escapeHtml(button.label)}</a>` : ''}
          ${footnote ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#64748b">${footnote}</p>` : ''}
        </td></tr>
        <tr><td style="padding:16px 4px;font-size:12px;color:#94a3b8">You receive this email because you have a SportBook account.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function plain({ heading, introText, details = [], button, footnoteText }) {
    return [
        heading,
        '',
        introText,
        '',
        ...details.map(([label, value]) => `${label}: ${value}`),
        button ? `\n${button.label}: ${button.url}` : '',
        footnoteText ? `\n${footnoteText}` : '',
    ].join('\n').trim();
}

function bookingDetails({ venue, booking }) {
    return [
        ['Venue', venue.name || 'Venue'],
        ['Sport', SPORT[venue.type] || '—'],
        ['When', formatWhen(booking.startTime, booking.endTime)],
        ['Address', venue.location || '—'],
        ['Price', money(booking.price)],
    ];
}

const myBookings = () => ({ label: 'View my bookings', url: `${APP_URL()}/?view=profile` });

const templates = {
    welcome: ({ user }) => {
        const heading = `Welcome to SportBook, ${user.name}!`;
        const introText = 'Your account is ready. Find a football field, tennis or basketball court nearby and book a time in a couple of clicks.';
        const button = { label: 'Find a venue', url: APP_URL() };
        return {
            subject: 'Welcome to SportBook',
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), button }),
            text: plain({ heading, introText, button }),
        };
    },

    booking_confirmed: ({ user, venue, booking }) => {
        const heading = 'Your booking is confirmed';
        const introText = `Hi ${user.name}, you're all set. See you on the court!`;
        const details = bookingDetails({ venue, booking });
        return {
            subject: `Booking confirmed: ${venue.name}, ${formatWhen(booking.startTime, booking.endTime)}`,
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), details, button: myBookings(),
                footnote: 'Can\'t make it? You can cancel the booking in your profile and the slot will be released for other players.' }),
            text: plain({ heading, introText, details, button: myBookings() }),
        };
    },

    booking_cancelled: ({ user, venue, booking }) => {
        const heading = 'Your booking was cancelled';
        const refund = booking.refund;
        const introText = `Hi ${user.name}, this booking has been cancelled and the slot is free again.`
            + (refund ? ` A refund of ${money(refund.amount)} is on its way to your card — it usually shows up within 5–10 business days.` : '');
        const details = bookingDetails({ venue, booking });
        if (refund) details.push(['Refund', money(refund.amount)]);
        const button = { label: 'Book another time', url: APP_URL() };
        return {
            subject: `Booking cancelled: ${venue.name}`,
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), details, button }),
            text: plain({ heading, introText, details, button }),
        };
    },

    booking_expired: ({ user, venue, booking }) => {
        const heading = 'Your reservation expired';
        const introText = `Hi ${user.name}, we held this slot for you while you paid, but the payment didn't go through in time. The slot is free again — you can book it once more if it's still available.`;
        const details = bookingDetails({ venue, booking });
        const button = { label: 'Book again', url: APP_URL() };
        return {
            subject: `Reservation expired: ${venue.name}`,
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), details, button }),
            text: plain({ heading, introText, details, button }),
        };
    },

    payment_refunded: ({ user, amount, reason }) => {
        const heading = "You've been refunded";
        const introText = reason === 'late_payment'
            ? `Hi ${user.name}, your payment of ${money(amount)} arrived after the reservation had expired and the slot had been released, so we refunded it in full. It usually shows up within 5–10 business days.`
            : `Hi ${user.name}, ${money(amount)} has been refunded to your card. It usually shows up within 5–10 business days.`;
        const button = { label: 'Book a new time', url: APP_URL() };
        return {
            subject: `Refund of ${money(amount)} issued`,
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), button }),
            text: plain({ heading, introText, button }),
        };
    },

    booking_reminder: ({ user, venue, booking }) => {
        const heading = `Your game is ${relativeDay(booking.startTime)}`;
        const introText = `Hi ${user.name}, just a reminder about your upcoming game.`;
        const details = bookingDetails({ venue, booking });
        return {
            subject: `Reminder: ${venue.name}, ${formatWhen(booking.startTime, booking.endTime)}`,
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), details, button: myBookings() }),
            text: plain({ heading, introText, details, button: myBookings() }),
        };
    },

    password_reset: ({ user, token }) => {
        const heading = 'Reset your password';
        const introText = `Hi ${user.name}, we received a request to reset your SportBook password. The link is valid for 1 hour.`;
        const button = { label: 'Choose a new password', url: `${APP_URL()}/?reset=${encodeURIComponent(token)}` };
        const footnoteText = 'If you didn\'t request this, you can ignore this email — your password stays the same.';
        return {
            subject: 'Reset your SportBook password',
            html: layout({ preheader: introText, heading, intro: escapeHtml(introText), button, footnote: escapeHtml(footnoteText) }),
            text: plain({ heading, introText, button, footnoteText }),
        };
    },
};

module.exports = { templates, escapeHtml, formatWhen };
