import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import styles from './UserProfile.module.css';
import { apiFetch, sportLabel, VENUE_TYPE_ICONS } from '../api';
import { formatDay, formatMoney, formatMoneyCompact, formatTimeRange } from '../format';
import { computeStats } from '../profileStats';
import Avatar from './Avatar';
import Modal from './Modal';
import { useToast } from './Toast';
import NextGame from './profile/NextGame';
import ActivityHeatmap from './profile/ActivityHeatmap';
import Achievements from './profile/Achievements';
import EditProfileModal from './profile/EditProfileModal';
import ReviewModal from './profile/ReviewModal';
import SavedVenues from './profile/SavedVenues';
import { Stars } from './Stars';

const HISTORY_PAGE = 10;

const BookingItem = ({ booking, onCancel, onBookAgain, onReview }) => {
    const start = new Date(booking.start_time);
    const isUpcoming = booking.status === 'booked' && start > new Date();
    const played = booking.status === 'booked' && new Date(booking.end_time) <= new Date();

    let badge;
    if (booking.status === 'cancelled') badge = <span className="badge">Cancelled</span>;
    else if (isUpcoming) badge = <span className="badge badge-success">Active</span>;
    else badge = <span className="badge">Completed</span>;

    return (
        <li className={`${styles.booking} ${booking.status === 'cancelled' ? styles.bookingCancelled : ''}`}>
            <div className={styles.dateBlock} aria-hidden="true">
                <span className={styles.dateDay}>{format(start, 'd')}</span>
                <span className={styles.dateMonth}>{format(start, 'LLL')}</span>
            </div>
            <div className={styles.bookingInfo}>
                <p className={styles.bookingVenue}>
                    <span aria-hidden="true">{VENUE_TYPE_ICONS[booking.venue?.type] || ''}</span>{' '}
                    {booking.venue?.name ?? 'Deleted venue'}
                </p>
                <p className={styles.bookingTime}>
                    {formatDay(booking.start_time)} · <span className={styles.nowrap}>{formatTimeRange(booking.start_time, booking.end_time)}</span>
                </p>
                {booking.review && (
                    <p className={styles.bookingReview}>
                        <Stars value={booking.review.rating} size={13} />
                        {booking.review.comment && <span>“{booking.review.comment}”</span>}
                    </p>
                )}
            </div>
            <div className={styles.bookingSide}>
                {Number(booking.price) > 0 && <span className={styles.bookingPrice}>{formatMoney(booking.price)}</span>}
                {badge}
                {isUpcoming && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onCancel(booking)}>Cancel</button>
                )}
                {played && booking.venue?.name && (
                    <button className={`btn btn-sm ${booking.review ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => onReview(booking)}>
                        {booking.review ? 'Edit review' : '★ Rate'}
                    </button>
                )}
                {!isUpcoming && booking.venue?.name && (
                    <button className="btn btn-ghost btn-sm" onClick={() => onBookAgain(booking.venue_id)}>Book again</button>
                )}
            </div>
        </li>
    );
};

const StatTile = ({ label, value, hint, icon }) => (
    <div className={styles.statTile}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>
            {icon && <span aria-hidden="true">{icon} </span>}
            {value}
        </span>
        {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
);

const UserProfile = ({ onBrowse, onBookAgain, onOpenVenue, onProfileUpdated, favorites = new Set(), onToggleFavorite }) => {
    const toast = useToast();
    const [user, setUser] = useState(null);
    const [bookings, setBookings] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('upcoming'); // 'upcoming' | 'history'
    const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
    const [cancelling, setCancelling] = useState(null);
    const [editing, setEditing] = useState(false);
    const [reviewing, setReviewing] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        apiFetch('/api/user/profile', { auth: true })
            .then(profile => {
                setUser(profile);
                return apiFetch(`/api/bookings/${profile.id}`, { auth: true });
            })
            .then(setBookings)
            .catch(err => toast(`Failed to load profile: ${err.message}`, 'error'))
            .finally(() => setLoading(false));
    }, [toast]);

    const stats = useMemo(() => computeStats(bookings), [bookings]);

    const { upcoming, history } = useMemo(() => {
        const now = new Date();
        const isUpcoming = (b) => b.status === 'booked' && new Date(b.start_time) > now;
        return {
            upcoming: bookings.filter(isUpcoming).sort((a, b) => new Date(a.start_time) - new Date(b.start_time)),
            history: bookings.filter(b => !isUpcoming(b)).sort((a, b) => new Date(b.start_time) - new Date(a.start_time)),
        };
    }, [bookings]);

    const closeCancel = useCallback(() => setCancelling(null), []);
    const closeEdit = useCallback(() => setEditing(false), []);
    const closeReview = useCallback(() => setReviewing(null), []);

    const handleReviewSaved = (bookingId, review) => {
        setBookings(prev => prev.map(b => (b.id === bookingId ? { ...b, review } : b)));
        setReviewing(null);
    };

    const confirmCancel = () => {
        setSubmitting(true);
        apiFetch(`/api/bookings/${cancelling.id}`, { method: 'DELETE', auth: true })
            .then(() => {
                setBookings(prev => prev.map(b => (b.id === cancelling.id ? { ...b, status: 'cancelled' } : b)));
                toast('Booking cancelled', 'success');
                setCancelling(null);
            })
            .catch(err => toast(err.message, 'error'))
            .finally(() => setSubmitting(false));
    };

    const handleSaved = (profile) => {
        setUser(profile);
        setEditing(false);
        onProfileUpdated?.(profile);
    };

    if (loading) {
        return (
            <div className={styles.page} aria-busy="true">
                <div className={styles.topRow}>
                    <div className={styles.skeleton} style={{ height: 230 }} />
                    <div className={styles.skeleton} style={{ height: 230 }} />
                </div>
                <div className={styles.skeleton} style={{ height: 110 }} />
            </div>
        );
    }

    if (!user) {
        return <p className={styles.emptyText}>Failed to load profile.</p>;
    }

    const list = tab === 'upcoming' ? upcoming : history.slice(0, historyShown);
    const favorite = stats.favoriteSport;

    return (
        <div className={styles.page}>
            <div className={styles.topRow}>
                <section className={styles.profileCard}>
                    <Avatar name={user.name} email={user.email} color={user.avatar_color} src={user.avatar_url} size={76} />
                    <div className={styles.identity}>
                        <h1 className={styles.name}>{user.name}</h1>
                        <p className={styles.email}>{user.email}</p>
                        <p className={styles.memberSince}>
                            Member since {user.created_at ? format(new Date(user.created_at), 'MMMM yyyy') : '—'}
                            {user.role === 'admin' && <span className="badge badge-primary">Admin</span>}
                        </p>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit profile</button>
                </section>

                <NextGame booking={stats.nextGame} onBrowse={onBrowse} />
            </div>

            <div className={styles.statsRow}>
                <StatTile label="Games played" value={stats.gamesPlayed} hint={`${stats.upcomingCount} upcoming`} />
                <StatTile label="Hours on court" value={stats.hoursPlayed.toLocaleString('en-US', { maximumFractionDigits: 1 })} />
                <StatTile label="Total spent" value={formatMoneyCompact(stats.totalSpent)} />
                <StatTile
                    label="Favorite sport"
                    icon={favorite ? VENUE_TYPE_ICONS[favorite.value] : null}
                    value={favorite ? sportLabel(favorite.value) : '—'}
                    hint={stats.favoriteVenue ? `Most booked: ${stats.favoriteVenue.value}` : 'Book a game to find out'}
                />
            </div>

            <div className={styles.widgetsRow}>
                <ActivityHeatmap bookings={bookings} />
                <Achievements bookings={bookings} />
            </div>

            {!user || user.role !== 'admin' ? (
                <SavedVenues favorites={favorites} onToggleFavorite={onToggleFavorite} onOpenVenue={onOpenVenue} onBrowse={onBrowse} />
            ) : null}

            <section className={styles.bookingsPanel}>
                <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>My bookings</h2>
                    <div className={styles.tabs} role="tablist">
                        <button role="tab" aria-selected={tab === 'upcoming'}
                            className={`${styles.tab} ${tab === 'upcoming' ? styles.tabActive : ''}`}
                            onClick={() => setTab('upcoming')}>
                            Upcoming ({upcoming.length})
                        </button>
                        <button role="tab" aria-selected={tab === 'history'}
                            className={`${styles.tab} ${tab === 'history' ? styles.tabActive : ''}`}
                            onClick={() => setTab('history')}>
                            History ({history.length})
                        </button>
                    </div>
                </div>

                {list.length === 0 ? (
                    <div className={styles.empty}>
                        <div className={styles.emptyIcon} aria-hidden="true">{tab === 'upcoming' ? '🗓️' : '📭'}</div>
                        <p className={styles.emptyText}>
                            {tab === 'upcoming' ? 'No upcoming games' : 'No history yet'}
                        </p>
                        {tab === 'upcoming' && (
                            <button className="btn btn-primary" onClick={onBrowse}>Find a venue</button>
                        )}
                    </div>
                ) : (
                    <>
                        <ul className={styles.bookings}>
                            {list.map(booking => (
                                <BookingItem key={booking.id} booking={booking} onCancel={setCancelling} onBookAgain={onBookAgain} onReview={setReviewing} />
                            ))}
                        </ul>
                        {tab === 'history' && history.length > historyShown && (
                            <button className={`btn btn-secondary ${styles.showMore}`} onClick={() => setHistoryShown(n => n + HISTORY_PAGE)}>
                                Show more ({history.length - historyShown} left)
                            </button>
                        )}
                    </>
                )}
            </section>

            {cancelling && (
                <Modal title="Cancel booking?" onClose={closeCancel} width={420}>
                    <p className={styles.confirmText}>
                        {cancelling.venue?.name}, {formatDay(cancelling.start_time)},{' '}
                        {formatTimeRange(cancelling.start_time, cancelling.end_time)}. The slot will become available to others.
                    </p>
                    <div className={styles.confirmActions}>
                        <button className="btn btn-secondary" onClick={closeCancel}>Keep it</button>
                        <button className="btn btn-danger" onClick={confirmCancel} disabled={submitting}>
                            {submitting ? 'Cancelling…' : 'Cancel booking'}
                        </button>
                    </div>
                </Modal>
            )}

            {editing && <EditProfileModal user={user} onClose={closeEdit} onSaved={handleSaved} />}
            {reviewing && <ReviewModal booking={reviewing} onClose={closeReview} onSaved={handleReviewSaved} />}
        </div>
    );
};

export default UserProfile;
