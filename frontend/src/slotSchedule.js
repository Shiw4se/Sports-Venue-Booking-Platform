// Expands a recurring schedule ("Mon–Fri, 18:00–22:00, 60-minute slots, 4 weeks from Oct 6")
// into concrete slots in the admin's local time. Pure, so it is unit-tested.
import { addDays, format } from 'date-fns';

const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
};

// weekdays: date-fns day numbers (0 = Sunday … 6 = Saturday)
export function expandSchedule({ fromDate, weeks, weekdays, startTime, endTime, durationMinutes }, now = new Date()) {
    const dayStart = toMinutes(startTime);
    const dayEnd = toMinutes(endTime);
    if (!fromDate || !weeks || !weekdays.length || !durationMinutes || dayEnd <= dayStart) return [];

    const first = new Date(`${fromDate}T00:00`);
    const slots = [];
    for (let i = 0; i < weeks * 7; i++) {
        const day = addDays(first, i);
        if (!weekdays.includes(day.getDay())) continue;
        for (let m = dayStart; m + durationMinutes <= dayEnd; m += durationMinutes) {
            const start = new Date(`${format(day, 'yyyy-MM-dd')}T00:00`);
            start.setMinutes(m);
            const end = new Date(start.getTime() + durationMinutes * 60000);
            if (start > now) slots.push({ start_time: start.toISOString(), end_time: end.toISOString() });
        }
    }
    return slots;
}

export const WEEKDAYS = [
    { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' }, { day: 4, label: 'Thu' },
    { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' }, { day: 0, label: 'Sun' },
];
