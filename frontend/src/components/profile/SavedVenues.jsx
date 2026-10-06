import React, { useEffect, useState } from 'react';
import styles from './profile.module.css';
import { apiFetch, VENUE_TYPE_ICONS, venueTypeLabel } from '../../api';
import { formatMoney } from '../../format';
import HeartButton from '../HeartButton';
import { photoUrl } from '../PhotoManager';
import { Stars } from '../Stars';

// Venues the user hearted; clicking one opens its venue page
const SavedVenues = ({ favorites, onToggleFavorite, onOpenVenue, onBrowse }) => {
    const [venues, setVenues] = useState(null);

    useEffect(() => {
        apiFetch('/api/venue/get_all').then(setVenues).catch(() => setVenues([]));
    }, []);

    const saved = (venues || []).filter(v => favorites.has(v.id));

    return (
        <section className={styles.card}>
            <div className={styles.cardHeader}>
                <h2 className={styles.cardTitle}>Saved venues</h2>
                <span className={styles.muted}>{saved.length} saved</span>
            </div>
            {venues === null ? null : saved.length === 0 ? (
                <div className={styles.savedEmpty}>
                    <p className={styles.muted}>Tap ♥ on a venue to keep it here.</p>
                    <button className="btn btn-secondary btn-sm" onClick={onBrowse}>Browse venues</button>
                </div>
            ) : (
                <ul className={styles.savedList}>
                    {saved.map(v => (
                        <li key={v.id} className={styles.savedItem}>
                            <button className={styles.savedOpen} onClick={() => onOpenVenue(v.id)}>
                                <span
                                    className={`${styles.savedThumb} ${styles[v.type] || ''}`}
                                    style={v.photo_ids?.length ? { backgroundImage: `url(${photoUrl(v.photo_ids[0])})` } : undefined}
                                    aria-hidden="true"
                                >
                                    {!v.photo_ids?.length && (VENUE_TYPE_ICONS[v.type] || '🏟️')}
                                </span>
                                <span className={styles.savedText}>
                                    <strong>{v.name}</strong>
                                    <span className={styles.savedMeta}>
                                        {venueTypeLabel(v.type)}
                                        {Number(v.price_per_hour) > 0 && <> · {formatMoney(v.price_per_hour)}/h</>}
                                    </span>
                                    {v.rating_count > 0 && (
                                        <span className={styles.savedMeta}>
                                            <Stars value={Number(v.rating_avg)} size={12} /> {Number(v.rating_avg).toFixed(1)}
                                        </span>
                                    )}
                                </span>
                            </button>
                            <HeartButton saved onToggle={() => onToggleFavorite(v.id)} venueName={v.name} size={16} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

export default SavedVenues;
