// Pure helpers that turn a user's bookings into profile stats, achievements and an activity heatmap.
// "Active" = not cancelled; "played" = active and already finished.
import { format, startOfWeek, addDays } from 'date-fns';

const HOUR = 3600000;
const durationHours = (b) => (new Date(b.end_time) - new Date(b.start_time)) / HOUR;

function mode(values) {
    const counts = new Map();
    values.filter(Boolean).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let best = null;
    counts.forEach((count, value) => {
        if (!best || count > best.count) best = { value, count };
    });
    return best;
}

export function splitBookings(bookings, now = new Date()) {
    const active = bookings.filter(b => b.status === 'booked');
    const played = active.filter(b => new Date(b.end_time) <= now);
    const upcoming = active
        .filter(b => new Date(b.start_time) > now)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return { active, played, upcoming };
}

export function computeStats(bookings, now = new Date()) {
    const { active, played, upcoming } = splitBookings(bookings, now);
    return {
        gamesPlayed: played.length,
        hoursPlayed: played.reduce((sum, b) => sum + durationHours(b), 0),
        totalSpent: active.reduce((sum, b) => sum + (Number(b.price) || 0), 0),
        favoriteSport: mode(active.map(b => b.venue?.type)),
        favoriteVenue: mode(active.map(b => b.venue?.name)),
        nextGame: upcoming[0] || null,
        upcomingCount: upcoming.length,
    };
}

const ACHIEVEMENTS = [
    { id: 'first', icon: '🎟️', title: 'First booking', description: 'Book your first game', target: 1,
      value: ({ active }) => active.length },
    { id: 'regular', icon: '🏅', title: 'Regular', description: 'Play 25 games', target: 25,
      value: ({ played }) => played.length },
    { id: 'early', icon: '🌅', title: 'Early bird', description: 'Play a game that starts before 9:00', target: 1,
      value: ({ played }) => played.filter(b => new Date(b.start_time).getHours() < 9).length },
    { id: 'night', icon: '🦉', title: 'Night owl', description: 'Play a game that starts at 20:00 or later', target: 1,
      value: ({ played }) => played.filter(b => new Date(b.start_time).getHours() >= 20).length },
    { id: 'allrounder', icon: '🧭', title: 'All-rounder', description: 'Book football, tennis and basketball', target: 3,
      value: ({ active }) => new Set(active.map(b => b.venue?.type).filter(Boolean)).size },
    { id: 'loyal', icon: '💚', title: 'Loyal fan', description: 'Book 5 games at the same venue', target: 5,
      value: ({ active }) => mode(active.map(b => b.venue_id))?.count || 0 },
    { id: 'weekend', icon: '🗓️', title: 'Weekend warrior', description: 'Play 15 games on weekends', target: 15,
      value: ({ played }) => played.filter(b => [0, 6].includes(new Date(b.start_time).getDay())).length },
    { id: 'marathon', icon: '⏱️', title: 'Marathon', description: 'Spend 50 hours on court', target: 50,
      value: ({ played }) => Math.floor(played.reduce((sum, b) => sum + durationHours(b), 0)) },
];

export function computeAchievements(bookings, now = new Date()) {
    const groups = splitBookings(bookings, now);
    return ACHIEVEMENTS.map(({ value, ...a }) => {
        const current = Math.min(value(groups), a.target);
        return { ...a, current, unlocked: current >= a.target };
    });
}

// Games per day for the last `weeks` weeks (Monday-first columns, local time)
export function computeHeatmap(bookings, now = new Date(), weeks = 12) {
    const { played } = splitBookings(bookings, now);
    const counts = new Map();
    played.forEach(b => {
        const key = format(new Date(b.start_time), 'yyyy-MM-dd');
        counts.set(key, (counts.get(key) || 0) + 1);
    });

    const todayKey = format(now, 'yyyy-MM-dd');
    const firstDay = addDays(startOfWeek(now, { weekStartsOn: 1 }), -(weeks - 1) * 7);
    const columns = [];
    let total = 0;
    let max = 0;

    for (let w = 0; w < weeks; w++) {
        const column = [];
        for (let d = 0; d < 7; d++) {
            const date = addDays(firstDay, w * 7 + d);
            const key = format(date, 'yyyy-MM-dd');
            const count = counts.get(key) || 0;
            const future = key > todayKey;
            if (!future) {
                total += count;
                max = Math.max(max, count);
            }
            column.push({ date, key, count, future });
        }
        columns.push(column);
    }
    // Weeks with at least one game, and the weekday (0 = Monday) with the most games
    const activeWeeks = columns.filter(col => col.some(c => !c.future && c.count > 0)).length;
    const perWeekday = Array.from({ length: 7 }, (_, d) => columns.reduce((sum, col) => sum + (col[d].future ? 0 : col[d].count), 0));
    const busiest = Math.max(...perWeekday);
    const busiestWeekday = busiest > 0 ? perWeekday.indexOf(busiest) : null;

    return { columns, total, max, activeWeeks, busiestWeekday };
}

// 0 = no games; 1–3 = increasing intensity
export const heatLevel = (count) => (count <= 0 ? 0 : Math.min(count, 3));
