// "Add to calendar": builds an .ics file for a booking and downloads it

const icsDate = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (value) => String(value ?? '').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

export function bookingToIcs(booking) {
    const venue = booking.venue || {};
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//SportBook//Bookings//EN',
        'BEGIN:VEVENT',
        `UID:${booking.id}@sportbook`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(booking.start_time)}`,
        `DTEND:${icsDate(booking.end_time)}`,
        `SUMMARY:${icsText(`${venue.name || 'Game'} — SportBook`)}`,
        venue.location ? `LOCATION:${icsText(venue.location)}` : null,
        'END:VEVENT',
        'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
}

export function downloadIcs(booking) {
    const blob = new Blob([bookingToIcs(booking)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'sportbook-game.ics';
    link.click();
    URL.revokeObjectURL(url);
}

export const mapsUrl = (location) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
