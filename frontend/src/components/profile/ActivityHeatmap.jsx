import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import styles from './profile.module.css';
import { computeHeatmap, heatLevel } from '../../profileStats';

const WEEKS = 12;
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];
const WEEKDAYS = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const gamesText = (n) => `${n} ${n === 1 ? 'game' : 'games'}`;

// GitHub-style grid of games per day; one hue, darker = more games
const ActivityHeatmap = ({ bookings }) => {
    const { columns, total, activeWeeks, busiestWeekday } = useMemo(() => computeHeatmap(bookings, new Date(), WEEKS), [bookings]);
    const [active, setActive] = useState(null);

    // Month label above the first column that starts in a new month
    const monthLabels = columns.map((col, i) => {
        const month = format(col[0].date, 'MMM');
        return i === 0 || month !== format(columns[i - 1][0].date, 'MMM') ? month : '';
    });

    return (
        <section className={styles.card}>
            <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Activity</h2>
                <span className={styles.muted}>{gamesText(total)} in the last {WEEKS} weeks</span>
            </div>

            <div className={styles.heatmap}>
                <div className={styles.heatDays} aria-hidden="true">
                    {DAY_LABELS.map((d, i) => <span key={i}>{d}</span>)}
                </div>
                <div className={styles.heatBody}>
                    <div className={styles.heatMonths} aria-hidden="true">
                        {monthLabels.map((m, i) => <span key={i}>{m}</span>)}
                    </div>
                    <div className={styles.heatGrid} role="grid" aria-label={`Games per day, last ${WEEKS} weeks`}>
                        {columns.map((col, w) => (
                            <div key={w} className={styles.heatColumn} role="row">
                                {col.map(cell => (
                                    <span
                                        key={cell.key}
                                        role="gridcell"
                                        tabIndex={cell.future ? -1 : 0}
                                        aria-label={`${format(cell.date, 'EEE, MMM d')}: ${gamesText(cell.count)}`}
                                        className={`${styles.heatCell} ${cell.future ? styles.heatFuture : styles[`heat${heatLevel(cell.count)}`]}`}
                                        onMouseEnter={() => !cell.future && setActive(cell)}
                                        onMouseLeave={() => setActive(null)}
                                        onFocus={() => !cell.future && setActive(cell)}
                                        onBlur={() => setActive(null)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <dl className={styles.heatStats}>
                <div>
                    <dt>Active weeks</dt>
                    <dd>{activeWeeks} of {WEEKS}</dd>
                </div>
                <div>
                    <dt>Favorite day</dt>
                    <dd>{busiestWeekday === null ? '—' : WEEKDAYS[busiestWeekday]}</dd>
                </div>
            </dl>

            <div className={styles.heatFooter}>
                <span className={styles.heatCaption} aria-live="polite">
                    {active
                        ? <><strong>{format(active.date, 'EEE, MMM d')}</strong> · {gamesText(active.count)}</>
                        : 'Hover a day for details'}
                </span>
                <span className={styles.heatLegend} aria-hidden="true">
                    Less
                    {[0, 1, 2, 3].map(l => <span key={l} className={`${styles.heatCell} ${styles[`heat${l}`]}`} />)}
                    More
                </span>
            </div>
        </section>
    );
};

export default ActivityHeatmap;
