import React, { useEffect, useMemo, useState } from 'react';
import { addDays, differenceInCalendarDays, format, isSameDay, startOfDay } from 'date-fns';
import styles from './VenueDetails.module.css';
import { AMENITIES, apiFetch, VENUE_TYPE_ICONS, venueTypeLabel } from '../api';
import { formatMoney, formatTimeRange } from '../format';
import { mapsUrl } from '../calendar';
import HeartButton from './HeartButton';
import { photoUrl } from './PhotoManager';
import VenueReviews from './VenueReviews';
import { Stars } from './Stars';

const DAYS_AHEAD = 7;
const QUICK_SLOTS = 6;

// Free/total slots per day for the next week, the next free slots and how busy the week is
function summarizeSlots(slots, now = new Date()) {
    const today = startOfDay(now);
    const upcoming = slots.filter(s => new Date(s.start_time) > now && new Date(s.start_time) < addDays(today, DAYS_AHEAD));
    const days = Array.from({ length: DAYS_AHEAD }, (_, i) => {
        const date = addDays(today, i);
        const daySlots = upcoming.filter(s => isSameDay(new Date(s.start_time), date));
        return { date, total: daySlots.length, free: daySlots.filter(s => s.is_available).length };
    });
    const free = upcoming
        .filter(s => s.is_available)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const booked = upcoming.length - free.length;
    return {
        days,
        nextFree: free.slice(0, QUICK_SLOTS),
        freeCount: free.length,
        occupancy: upcoming.length ? Math.round((booked / upcoming.length) * 100) : null,
    };
}

const dayLabel = (date, i) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(date, 'EEE, MMM d'));

// "Today" / "Tomorrow" / "Thursday" for a date within the next week
const relativeDay = (date) => {
    const diff = differenceInCalendarDays(date, new Date());
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : format(date, 'EEEE');
};

const Gallery = ({ venue }) => {
    const ids = venue.photo_ids || [];
    const [active, setActive] = useState(0);
    useEffect(() => setActive(0), [venue.id, ids.length]);
    if (ids.length === 0) return null;
    const current = ids[Math.min(active, ids.length - 1)];
    const description = `${venue.name}, view ${active + 1} of ${ids.length}`;

    return (
        <section className={styles.gallery} aria-label="Photos">
            <img className={styles.galleryMain} src={photoUrl(current)} alt={description} />
            {ids.length > 1 && (
                <ul className={styles.thumbs}>
                    {ids.map((id, i) => (
                        <li key={id}>
                            <button
                                className={`${styles.thumb} ${i === active ? styles.thumbActive : ''}`}
                                onClick={() => setActive(i)}
                                aria-label={`Show photo ${i + 1}`}
                                aria-current={i === active}
                            >
                                <img src={photoUrl(id)} alt="" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
};

const VenueDetails = ({ venue, isAdmin, refreshKey, saved, onToggleFavorite, onBack, onBook, onEdit, onSlots, onPhotos, onDelete }) => {
    const [slots, setSlots] = useState(null);

    useEffect(() => {
        setSlots(null);
        apiFetch(`/api/venue/find_by_id/${venue.id}`)
            .then(setSlots)
            .catch(() => setSlots([]));
    }, [venue.id, refreshKey]);

    const summary = useMemo(() => summarizeSlots(slots || []), [slots]);
    const amenities = venue.amenities || [];
    const maxPerDay = Math.max(1, ...summary.days.map(d => d.total));

    const facts = [
        { label: 'Sport', value: venueTypeLabel(venue.type), icon: VENUE_TYPE_ICONS[venue.type] },
        { label: 'Setting', value: venue.indoor ? 'Indoor' : 'Outdoor', icon: venue.indoor ? '🏠' : '🌤️' },
        { label: 'Surface', value: venue.surface || '—', icon: '🧱' },
        { label: 'Capacity', value: venue.capacity ? `Up to ${venue.capacity} players` : '—', icon: '👥' },
    ];

    return (
        <div className={styles.page}>
            <button className={styles.back} onClick={onBack}>← All venues</button>

            <header
                className={`${styles.hero} ${styles[venue.type] || ''} ${venue.photo_ids?.length ? styles.heroPhoto : ''}`}
                style={venue.photo_ids?.length ? { backgroundImage: `linear-gradient(90deg, rgba(15,23,42,0.82), rgba(15,23,42,0.35)), url(${photoUrl(venue.photo_ids[0])})` } : undefined}
            >
                <span className={styles.heroIcon} aria-hidden="true">{VENUE_TYPE_ICONS[venue.type] || '🏟️'}</span>
                <div className={styles.heroText}>
                    <div className={styles.heroBadges}>
                        <span className={styles.heroBadge}>{venueTypeLabel(venue.type)}</span>
                        <span className={styles.heroBadge}>{venue.indoor ? 'Indoor' : 'Outdoor'}</span>
                    </div>
                    <h1 className={styles.heroTitle}>{venue.name}</h1>
                    <p className={styles.heroLocation}>📍 {venue.location}</p>
                    {venue.rating_count > 0 && (
                        <p className={styles.heroRating}>
                            <Stars value={Number(venue.rating_avg)} size={16} />
                            <strong>{Number(venue.rating_avg).toFixed(1)}</strong>
                            <span>· {venue.rating_count} review{venue.rating_count === 1 ? '' : 's'}</span>
                        </p>
                    )}
                </div>
                {!isAdmin && (
                    <div className={styles.heroHeart}>
                        <HeartButton saved={saved} onToggle={() => onToggleFavorite(venue.id)} venueName={venue.name} floating size={22} />
                    </div>
                )}
                {Number(venue.price_per_hour) > 0 && (
                    <div className={styles.heroPrice}>
                        <strong>{formatMoney(venue.price_per_hour)}</strong>
                        <span>per hour</span>
                    </div>
                )}
            </header>

            <div className={styles.layout}>
                <div className={styles.main}>
                    <Gallery venue={venue} />

                    <section className={styles.card}>
                        <h2 className={styles.cardTitle}>About</h2>
                        <p className={styles.description}>{venue.description || 'No description yet.'}</p>
                        <dl className={styles.facts}>
                            {facts.map(f => (
                                <div key={f.label} className={styles.fact}>
                                    <span className={styles.factIcon} aria-hidden="true">{f.icon}</span>
                                    <div>
                                        <dt>{f.label}</dt>
                                        <dd>{f.value}</dd>
                                    </div>
                                </div>
                            ))}
                        </dl>
                    </section>

                    <section className={styles.card}>
                        <h2 className={styles.cardTitle}>Amenities</h2>
                        <ul className={styles.amenities}>
                            {Object.entries(AMENITIES).map(([key, a]) => {
                                const has = amenities.includes(key);
                                return (
                                    <li key={key} className={`${styles.amenity} ${has ? '' : styles.amenityMissing}`}>
                                        <span aria-hidden="true">{a.icon}</span>
                                        {a.label}
                                        {!has && <span className="sr-only"> — not available</span>}
                                    </li>
                                );
                            })}
                        </ul>
                    </section>

                    <section className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Availability this week</h2>
                            {slots && <span className={styles.muted}>{summary.freeCount} free slots</span>}
                        </div>
                        {slots === null ? (
                            <div className={styles.skeleton} style={{ height: 200 }} />
                        ) : (
                            <ul className={styles.availability}>
                                {summary.days.map((d, i) => (
                                    <li key={d.date.toISOString()} className={styles.availabilityRow}>
                                        <span className={styles.availabilityDay}>{dayLabel(d.date, i)}</span>
                                        <span className={styles.availabilityTrack} aria-hidden="true">
                                            <span className={styles.availabilityBooked} style={{ width: `${(d.total / maxPerDay) * 100}%` }}>
                                                <span className={styles.availabilityFree} style={{ width: d.total ? `${(d.free / d.total) * 100}%` : 0 }} />
                                            </span>
                                        </span>
                                        <span className={styles.availabilityCount}>
                                            {d.total === 0 ? 'No slots' : d.free === 0 ? 'Fully booked' : `${d.free} of ${d.total} free`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className={styles.legend} aria-hidden="true">
                            <span><i className={styles.legendFree} /> Free</span>
                            <span><i className={styles.legendBooked} /> Booked</span>
                        </p>
                    </section>

                    <VenueReviews venueId={venue.id} refreshKey={refreshKey} />
                </div>

                <aside className={styles.sidebar}>
                    <section className={`${styles.card} ${styles.bookCard}`}>
                        {isAdmin ? (
                            <>
                                <h2 className={styles.cardTitle}>Manage venue</h2>
                                <div className={styles.adminActions}>
                                    <button className="btn btn-primary btn-block" onClick={() => onSlots(venue)}>Manage slots</button>
                                    <button className="btn btn-secondary btn-block" onClick={() => onPhotos(venue)}>
                                        Photos ({venue.photo_ids?.length || 0})
                                    </button>
                                    <button className="btn btn-secondary btn-block" onClick={() => onEdit(venue)}>Edit details</button>
                                    <button className="btn btn-danger btn-block" onClick={() => onDelete(venue)}>Delete venue</button>
                                </div>
                            </>
                        ) : (
                            <>
                                <h2 className={styles.cardTitle}>Next free times</h2>
                                {slots === null ? (
                                    <div className={styles.skeleton} style={{ height: 96 }} />
                                ) : summary.nextFree.length === 0 ? (
                                    <p className={styles.muted}>No free slots in the next {DAYS_AHEAD} days.</p>
                                ) : (
                                    <ul className={styles.quickSlots}>
                                        {summary.nextFree.map(s => (
                                            <li key={s.id}>
                                                <button className={styles.quickSlot} onClick={() => onBook(venue, s.id)}>
                                                    <span className={styles.quickDay}>{relativeDay(new Date(s.start_time))}</span>
                                                    <span className={styles.quickTime}>{formatTimeRange(s.start_time, s.end_time)}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <button className="btn btn-primary btn-block" onClick={() => onBook(venue)}>See all times &amp; book</button>
                            </>
                        )}

                        {summary.occupancy !== null && (
                            <div className={styles.occupancy}>
                                <div className={styles.occupancyText}>
                                    <span>This week</span>
                                    <strong>{summary.occupancy}% booked</strong>
                                </div>
                                <span className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={summary.occupancy} aria-label="Share of slots booked this week">
                                    <span className={styles.meterFill} style={{ width: `${summary.occupancy}%` }} />
                                </span>
                                {summary.occupancy >= 70 && <p className={styles.hot}>🔥 Popular — book early</p>}
                            </div>
                        )}
                    </section>

                    <section className={styles.card}>
                        <h2 className={styles.cardTitle}>Location</h2>
                        <p className={styles.address}>📍 {venue.location}</p>
                        <a className="btn btn-secondary btn-block" href={mapsUrl(venue.location)} target="_blank" rel="noreferrer">
                            Open in Google Maps
                        </a>
                    </section>
                </aside>
            </div>
        </div>
    );
};

export default VenueDetails;
