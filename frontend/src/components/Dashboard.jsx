import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import styles from './Dashboard.module.css';
import { apiFetch } from '../api';
import { formatMoney, formatMoneyCompact } from '../format';

const StatTile = ({ label, value, hint }) => (
    <div className={styles.tile}>
        <span className={styles.tileLabel}>{label}</span>
        <span className={styles.tileValue}>{value}</span>
        {hint && <span className={styles.tileHint}>{hint}</span>}
    </div>
);

// Round the axis maximum up to a clean number so ticks are 0 / n / 2n
function niceMax(value) {
    if (value <= 4) return 4;
    const step = Math.pow(10, Math.floor(Math.log10(value)));
    return Math.ceil(value / step) * step;
}

// Column chart: bookings per day for the next 7 days (single series → no legend)
const NextDaysChart = ({ days }) => {
    const [hovered, setHovered] = useState(null);
    const max = niceMax(Math.max(...days.map(d => d.bookings)));
    const ticks = [max, max / 2, 0];
    const peak = Math.max(...days.map(d => d.bookings));

    return (
        <figure className={styles.chart}>
            <div className={styles.plot}>
                <div className={styles.yAxis} aria-hidden="true">
                    {ticks.map(t => <span key={t}>{t}</span>)}
                </div>
                <div className={styles.columns} role="img" aria-label="Bookings per day for the next 7 days">
                    {ticks.map((t, i) => (
                        <div key={t} className={styles.gridline} style={{ bottom: `${(1 - i / 2) * 100}%` }} aria-hidden="true" />
                    ))}
                    {days.map((d, i) => {
                        const date = new Date(`${d.date}T00:00:00`);
                        return (
                            <div
                                key={d.date}
                                className={styles.column}
                                onMouseEnter={() => setHovered(i)}
                                onMouseLeave={() => setHovered(null)}
                            >
                                {/* label only the busiest day; the tooltip and table carry the rest */}
                                {d.bookings === peak && peak > 0 && hovered === null && (
                                    <span className={styles.capLabel} style={{ bottom: `${(d.bookings / max) * 100}%` }}>{d.bookings}</span>
                                )}
                                <div className={styles.bar} style={{ height: `${(d.bookings / max) * 100}%` }} />
                                {hovered === i && (
                                    <div className={styles.tooltip} style={{ bottom: `${(d.bookings / max) * 100}%` }}>
                                        <strong>{format(date, 'EEE, MMM d')}</strong>
                                        <span>{d.bookings} {d.bookings === 1 ? 'booking' : 'bookings'}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className={styles.xAxis} aria-hidden="true">
                <span className={styles.yAxisSpacer} />
                {days.map((d, i) => (
                    <span key={d.date}>{i === 0 ? 'Today' : format(new Date(`${d.date}T00:00:00`), 'EEE')}</span>
                ))}
            </div>
            <details className={styles.tableToggle}>
                <summary>Show as table</summary>
                <table className={styles.table}>
                    <thead><tr><th>Date</th><th>Bookings</th></tr></thead>
                    <tbody>
                        {days.map(d => (
                            <tr key={d.date}>
                                <td>{format(new Date(`${d.date}T00:00:00`), 'EEE, MMM d')}</td>
                                <td>{d.bookings}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </figure>
    );
};

// Ranked bar list: value at the bar tip, revenue as secondary text
const TopVenues = ({ venues }) => {
    const max = Math.max(1, ...venues.map(v => v.bookings));
    return (
        <ol className={styles.ranking}>
            {venues.map(v => (
                <li key={v.venueId} className={styles.rankRow}>
                    <div className={styles.rankText}>
                        <span className={styles.rankName}>{v.name ?? 'Deleted venue'}</span>
                        <span className={styles.rankRevenue}>{formatMoney(v.revenue)}</span>
                    </div>
                    <div className={styles.rankTrack}>
                        <div className={styles.rankBar} style={{ width: `${(v.bookings / max) * 100}%` }} />
                        <span className={styles.rankValue}>{v.bookings}</span>
                    </div>
                </li>
            ))}
        </ol>
    );
};

const Dashboard = () => {
    const [stats, setStats] = useState(null);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        setError('');
        apiFetch('/api/admin/stats', { auth: true })
            .then(setStats)
            .catch(err => setError(err.message));
    }, []);

    useEffect(load, [load]);

    if (error) {
        return (
            <div className={styles.error}>
                <p>Failed to load statistics: {error}</p>
                <button className="btn btn-secondary" onClick={load}>Try again</button>
            </div>
        );
    }

    if (!stats) {
        return (
            <div aria-busy="true">
                <div className={styles.tiles}>
                    {Array.from({ length: 4 }, (_, i) => <div key={i} className={`${styles.tile} ${styles.skeleton}`} />)}
                </div>
            </div>
        );
    }

    const total = stats.activeBookings + stats.cancelledBookings;
    const cancelRate = total ? Math.round((stats.cancelledBookings / total) * 100) : 0;

    return (
        <div>
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>Dashboard</h1>
                    <p className={styles.subtitle}>Bookings and revenue across all venues</p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
            </div>

            <div className={styles.tiles}>
                <StatTile label="Revenue" value={formatMoneyCompact(stats.revenue)} hint="From active bookings" />
                <StatTile label="Active bookings" value={stats.activeBookings.toLocaleString('en-US')} />
                <StatTile label="Upcoming" value={stats.upcomingBookings.toLocaleString('en-US')} hint="Not played yet" />
                <StatTile label="Cancelled" value={stats.cancelledBookings.toLocaleString('en-US')} hint={`${cancelRate}% of all bookings`} />
            </div>

            <div className={styles.panels}>
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>Bookings in the next 7 days</h2>
                    <NextDaysChart days={stats.nextDays} />
                </section>
                <section className={styles.panel}>
                    <h2 className={styles.panelTitle}>Top venues by bookings</h2>
                    {stats.topVenues.length === 0
                        ? <p className={styles.muted}>No bookings yet.</p>
                        : <TopVenues venues={stats.topVenues} />}
                </section>
            </div>
        </div>
    );
};

export default Dashboard;
