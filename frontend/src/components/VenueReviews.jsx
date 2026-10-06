import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import styles from './VenueDetails.module.css';
import { apiFetch } from '../api';
import Avatar from './Avatar';
import { Stars } from './Stars';

// Rating summary, star distribution and the latest reviews of a venue
const VenueReviews = ({ venueId, refreshKey }) => {
    const [data, setData] = useState(null);

    useEffect(() => {
        apiFetch(`/api/venue/${venueId}/reviews`)
            .then(setData)
            .catch(() => setData({ average: null, count: 0, distribution: {}, reviews: [] }));
    }, [venueId, refreshKey]);

    if (!data) return <section className={styles.card}><div className={styles.skeleton} style={{ height: 160 }} /></section>;

    return (
        <section className={styles.card}>
            <h2 className={styles.cardTitle}>Reviews</h2>
            {data.count === 0 ? (
                <p className={styles.muted}>
                    No reviews yet. Reviews come only from players who booked and played here.
                </p>
            ) : (
                <>
                    <div className={styles.ratingSummary}>
                        <div className={styles.ratingBig}>
                            <strong>{data.average.toFixed(1)}</strong>
                            <Stars value={data.average} size={18} />
                            <span className={styles.muted}>{data.count} review{data.count === 1 ? '' : 's'}</span>
                        </div>
                        <ul className={styles.distribution} aria-label="Rating distribution">
                            {[5, 4, 3, 2, 1].map(star => {
                                const n = data.distribution[star] || 0;
                                return (
                                    <li key={star}>
                                        <span className={styles.distLabel}>{star}★</span>
                                        <span className={styles.distTrack} aria-hidden="true">
                                            <span className={styles.distFill} style={{ width: `${(n / data.count) * 100}%` }} />
                                        </span>
                                        <span className={styles.distCount}>{n}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <ul className={styles.reviewList}>
                        {data.reviews.map(r => (
                            <li key={r.id} className={styles.review}>
                                <Avatar name={r.author.name} color={r.author.avatar_color} src={r.author.avatar_url} size={36} />
                                <div className={styles.reviewBody}>
                                    <div className={styles.reviewHead}>
                                        <strong>{r.author.name}</strong>
                                        <Stars value={r.rating} size={14} />
                                        <span className={styles.reviewDate}>{format(new Date(r.created_at), 'MMM d, yyyy')}</span>
                                    </div>
                                    {r.comment && <p className={styles.reviewText}>{r.comment}</p>}
                                </div>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
};

export default VenueReviews;
