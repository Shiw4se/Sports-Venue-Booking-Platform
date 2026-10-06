import { computeAchievements, computeHeatmap, computeStats, heatLevel } from './profileStats';

const NOW = new Date(2026, 9, 7, 12, 0); // Wed, Oct 7 2026, 12:00 local

// Helper: booking on a local date/time with a duration in hours
function booking(id, { day, hour, hours = 1, type = 'football_field', venue = 'v1', price = 10, status = 'booked' }) {
    const start = new Date(2026, 9, day, hour, 0);
    return {
        id, status, price: String(price), venue_id: venue,
        start_time: start.toISOString(),
        end_time: new Date(start.getTime() + hours * 3600000).toISOString(),
        venue: { name: `Venue ${venue}`, type, location: 'Somewhere' },
    };
}

const bookings = [
    booking('a', { day: 3, hour: 8, hours: 1.5 }),                                  // Sat, early bird, weekend
    booking('b', { day: 5, hour: 20, type: 'tennis_court', venue: 'v2' }),           // night owl
    booking('c', { day: 6, hour: 18, status: 'cancelled' }),                         // ignored
    booking('d', { day: 8, hour: 10, type: 'basketball_court', venue: 'v3', price: 30 }), // upcoming
    booking('e', { day: 9, hour: 18 }),                                              // upcoming
];

test('stats count only active bookings and played games', () => {
    const stats = computeStats(bookings, NOW);
    expect(stats.gamesPlayed).toBe(2);
    expect(stats.hoursPlayed).toBe(2.5);
    expect(stats.totalSpent).toBe(60); // 10 + 10 + 30 + 10, cancelled excluded
    expect(stats.favoriteSport).toEqual({ value: 'football_field', count: 2 });
    expect(stats.nextGame.id).toBe('d');
    expect(stats.upcomingCount).toBe(2);
});

test('achievements unlock and report capped progress', () => {
    const byId = Object.fromEntries(computeAchievements(bookings, NOW).map(a => [a.id, a]));
    expect(byId.first.unlocked).toBe(true);
    expect(byId.early.unlocked).toBe(true);
    expect(byId.night.unlocked).toBe(true);
    expect(byId.allrounder).toMatchObject({ current: 3, unlocked: true });
    expect(byId.regular).toMatchObject({ current: 2, target: 25, unlocked: false });
    expect(byId.weekend.current).toBe(1);
});

test('heatmap has Monday-first weeks, counts played games and marks future days', () => {
    const { columns, total, max, activeWeeks, busiestWeekday } = computeHeatmap(bookings, NOW, 2);
    expect(columns).toHaveLength(2);
    expect(columns[0][0].date.getDay()).toBe(1); // Monday
    expect(total).toBe(2);
    expect(max).toBe(1);
    expect(activeWeeks).toBe(2);       // Sat Oct 3 and Mon Oct 5 fall into different weeks
    expect(busiestWeekday).toBe(0);    // Mon and Sat tie at 1 game; the first (Monday) wins
    const cells = columns.flat();
    expect(cells.find(c => c.key === '2026-10-03').count).toBe(1);
    expect(cells.find(c => c.key === '2026-10-08').future).toBe(true);
});

test('heat levels are capped at 3', () => {
    expect([0, 1, 2, 3, 7].map(heatLevel)).toEqual([0, 1, 2, 3, 3]);
});
