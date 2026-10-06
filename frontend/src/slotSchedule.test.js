import { expandSchedule } from './slotSchedule';

const NOW = new Date(2026, 9, 6, 12, 0); // Tue, Oct 6 2026, 12:00 local

test('weekday evenings for one week become hourly slots', () => {
    const slots = expandSchedule({
        fromDate: '2026-10-05', weeks: 1, weekdays: [1, 2, 3, 4, 5],
        startTime: '18:00', endTime: '22:00', durationMinutes: 60,
    }, NOW);
    // Mon Oct 5 is in the past → Tue–Fri × 4 slots
    expect(slots).toHaveLength(16);
    const first = new Date(slots[0].start_time);
    expect([first.getDate(), first.getHours(), first.getMinutes()]).toEqual([6, 18, 0]);
    expect(new Date(slots[0].end_time) - first).toBe(3600000);
});

test('slots that do not fit before the end time are dropped', () => {
    const slots = expandSchedule({
        fromDate: '2026-10-10', weeks: 1, weekdays: [6],
        startTime: '18:00', endTime: '22:00', durationMinutes: 90,
    }, NOW);
    // 18:00–19:30, 19:30–21:00; 21:00–22:30 would overrun 22:00
    expect(slots.map(s => new Date(s.start_time).getHours() * 60 + new Date(s.start_time).getMinutes())).toEqual([1080, 1170]);
});

test('several weeks and invalid input', () => {
    const base = { fromDate: '2026-10-07', weekdays: [6, 0], startTime: '10:00', endTime: '12:00', durationMinutes: 120 };
    expect(expandSchedule({ ...base, weeks: 4 }, NOW)).toHaveLength(8);
    expect(expandSchedule({ ...base, weeks: 4, endTime: '09:00' }, NOW)).toEqual([]);
    expect(expandSchedule({ ...base, weeks: 4, weekdays: [] }, NOW)).toEqual([]);
});
