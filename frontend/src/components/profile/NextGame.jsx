import React, { useEffect, useState } from 'react';
import styles from './profile.module.css';
import { VENUE_TYPE_ICONS, venueTypeLabel } from '../../api';
import { formatDay, formatMoney, formatTimeRange } from '../../format';
import { downloadIcs, mapsUrl } from '../../calendar';

const MINUTE = 60000;

export function formatCountdown(ms) {
    if (ms <= MINUTE) return 'starting now';
    const minutes = Math.floor(ms / MINUTE);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return `in ${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} h` : ''}`;
    if (hours > 0) return `in ${hours} h${mins ? ` ${mins} min` : ''}`;
    return `in ${mins} min`;
}

// Re-render every 30 s so the countdown stays current
function useNow(intervalMs = 30000) {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), intervalMs);
        return () => clearInterval(id);
    }, [intervalMs]);
    return now;
}

const NextGame = ({ booking, onBrowse }) => {
    const now = useNow();

    if (!booking) {
        return (
            <section className={`${styles.card} ${styles.nextEmpty}`}>
                <span className={styles.eyebrow}>Next game</span>
                <p className={styles.nextEmptyTitle}>Nothing planned yet</p>
                <p className={styles.muted}>Pick a venue and a time — your next game will show up here.</p>
                <button className="btn btn-primary" onClick={onBrowse}>Find a venue</button>
            </section>
        );
    }

    const venue = booking.venue || {};
    return (
        <section className={`${styles.nextGame} ${styles[venue.type] || ''}`}>
            <div className={styles.nextTop}>
                <span className={styles.eyebrowLight}>Next game</span>
                <span className={styles.countdown}>{formatCountdown(new Date(booking.start_time) - now)}</span>
            </div>
            <div className={styles.nextMain}>
                <span className={styles.nextIcon} aria-hidden="true">{VENUE_TYPE_ICONS[venue.type] || '🏟️'}</span>
                <div>
                    <h2 className={styles.nextVenue}>{venue.name || 'Venue'}</h2>
                    <p className={styles.nextWhen}>
                        {formatDay(booking.start_time)} · {formatTimeRange(booking.start_time, booking.end_time)}
                    </p>
                    <p className={styles.nextMeta}>
                        {venueTypeLabel(venue.type)}
                        {venue.location && <> · 📍 {venue.location}</>}
                        {Number(booking.price) > 0 && <> · {formatMoney(booking.price)}</>}
                    </p>
                </div>
            </div>
            <div className={styles.nextActions}>
                <button className={styles.glassButton} onClick={() => downloadIcs(booking)}>Add to calendar</button>
                {venue.location && (
                    <a className={styles.glassButton} href={mapsUrl(venue.location)} target="_blank" rel="noreferrer">
                        Directions
                    </a>
                )}
            </div>
        </section>
    );
};

export default NextGame;
