import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './VenueList.module.css';
import { AMENITIES, apiFetch, SURFACE_SUGGESTIONS, VENUE_TYPES, VENUE_TYPE_ICONS, venueTypeLabel } from '../api';
import { formatMoney, formatTimeRange, groupSlotsByDay } from '../format';
import Modal from './Modal';
import SlotManager from './SlotManager';
import VenueDetails from './VenueDetails';
import PhotoManager, { photoUrl } from './PhotoManager';
import HeartButton from './HeartButton';
import { Stars } from './Stars';
import { useToast } from './Toast';

const EMPTY_FORM = {
    name: '', location: '', type: '', description: '', price_per_hour: '',
    surface: '', indoor: false, capacity: '', amenities: [],
};

// Price of a slot: hourly venue price × duration
const slotPrice = (venue, slot) =>
    (Number(venue.price_per_hour) || 0) * (new Date(slot.end_time) - new Date(slot.start_time)) / 3600000;

const VenueFormModal = ({ venue, onClose, onSaved }) => {
    const toast = useToast();
    const [formData, setFormData] = useState(venue
        ? {
            name: venue.name, location: venue.location, type: venue.type, description: venue.description || '',
            price_per_hour: venue.price_per_hour ?? '', surface: venue.surface || '', indoor: Boolean(venue.indoor),
            capacity: venue.capacity ?? '', amenities: venue.amenities || [],
        }
        : EMPTY_FORM);
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };
    const toggleAmenity = (key) => setFormData(prev => ({
        ...prev,
        amenities: prev.amenities.includes(key) ? prev.amenities.filter(a => a !== key) : [...prev.amenities, key],
    }));

    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitting(true);
        const payload = {
            ...formData,
            price_per_hour: Number(formData.price_per_hour) || 0,
            capacity: formData.capacity === '' ? null : Number(formData.capacity),
            surface: formData.surface.trim() || null,
        };
        const request = venue
            ? apiFetch(`/api/venue/update/${venue.id}`, { method: 'PUT', auth: true, body: payload })
            : apiFetch('/api/venue/create', { method: 'POST', auth: true, body: payload });

        request
            .then(saved => {
                toast(venue ? 'Changes saved' : 'Venue added', 'success');
                onSaved(saved);
            })
            .catch(err => toast(err.message, 'error'))
            .finally(() => setSubmitting(false));
    };

    return (
        <Modal title={venue ? 'Edit venue' : 'New venue'} onClose={onClose} width={560}>
            <form className={styles.form} onSubmit={handleSubmit}>
                <label className="field">
                    <span className="field-label">Name</span>
                    <input className="input" name="name" placeholder="Olympic Stadium" value={formData.name} onChange={handleChange} required autoFocus />
                </label>
                <label className="field">
                    <span className="field-label">Address</span>
                    <input className="input" name="location" placeholder="1 Sports St" value={formData.location} onChange={handleChange} required />
                </label>
                <label className="field">
                    <span className="field-label">Type</span>
                    <select className="input" name="type" value={formData.type} onChange={handleChange} required>
                        <option value="" disabled>Select a type</option>
                        {Object.entries(VENUE_TYPES).map(([value, label]) => (
                            <option key={value} value={value}>{VENUE_TYPE_ICONS[value]} {label}</option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    <span className="field-label">Price per hour, USD</span>
                    <input className="input" type="number" name="price_per_hour" min="0" step="0.5" placeholder="40" value={formData.price_per_hour} onChange={handleChange} required />
                </label>
                <div className={styles.formRow}>
                    <label className="field">
                        <span className="field-label">Surface</span>
                        <input className="input" name="surface" list="surface-suggestions" placeholder="Artificial turf" value={formData.surface} onChange={handleChange} />
                        <datalist id="surface-suggestions">
                            {SURFACE_SUGGESTIONS.map(s => <option key={s} value={s} />)}
                        </datalist>
                    </label>
                    <label className="field">
                        <span className="field-label">Capacity, players</span>
                        <input className="input" type="number" name="capacity" min="1" max="100" placeholder="10" value={formData.capacity} onChange={handleChange} />
                    </label>
                </div>
                <label className={styles.checkboxRow}>
                    <input type="checkbox" name="indoor" checked={formData.indoor} onChange={handleChange} />
                    Indoor venue
                </label>
                <fieldset className={styles.amenityField}>
                    <legend className="field-label">Amenities</legend>
                    <div className={styles.amenityOptions}>
                        {Object.entries(AMENITIES).map(([key, a]) => (
                            <label key={key} className={`${styles.amenityOption} ${formData.amenities.includes(key) ? styles.amenityOptionOn : ''}`}>
                                <input type="checkbox" checked={formData.amenities.includes(key)} onChange={() => toggleAmenity(key)} />
                                <span aria-hidden="true">{a.icon}</span> {a.label}
                            </label>
                        ))}
                    </div>
                </fieldset>
                <label className="field">
                    <span className="field-label">Description <span className={styles.optional}>— optional</span></span>
                    <textarea className="input" name="description" placeholder="Surface, lighting, locker rooms…" value={formData.description} onChange={handleChange} />
                </label>
                <div className={styles.formActions}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Saving…' : venue ? 'Save' : 'Add'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

const BookingModal = ({ venue, initialSlotId, onClose, onBooked }) => {
    const toast = useToast();
    const [slots, setSlots] = useState(null); // null = loading
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const loadSlots = useCallback(() => {
        apiFetch(`/api/venue/find_by_id/${venue.id}`)
            .then(setSlots)
            .catch(err => {
                setSlots([]);
                toast(`Failed to load slots: ${err.message}`, 'error');
            });
    }, [venue.id, toast]);

    useEffect(loadSlots, [loadSlots]);

    // Opened from a quick-slot button on the venue page: preselect that slot
    useEffect(() => {
        if (!initialSlotId || !slots) return;
        const slot = slots.find(s => s.id === initialSlotId && s.is_available);
        if (slot) setSelectedSlot(slot);
    }, [initialSlotId, slots]);

    const days = useMemo(() => {
        const now = new Date();
        return groupSlotsByDay((slots || []).filter(s => s.is_available && new Date(s.start_time) > now));
    }, [slots]);

    const handleConfirm = () => {
        setSubmitting(true);
        let redirecting = false;
        apiFetch('/api/bookings/create', { method: 'POST', auth: true, body: { slot_id: selectedSlot.id } })
            .then((booking) => {
                if (booking?.checkout_url) {
                    // Paid slot: the booking is held for 30 minutes while the player pays on Stripe
                    redirecting = true;
                    toast('Redirecting to payment…');
                    window.location.assign(booking.checkout_url);
                    return;
                }
                toast('Booking confirmed!', 'success');
                onBooked();
            })
            .catch(err => {
                toast(err.message, 'error');
                // someone else may have taken the slot — refresh the list
                setSelectedSlot(null);
                loadSlots();
            })
            .finally(() => { if (!redirecting) setSubmitting(false); });
    };

    return (
        <Modal title={venue.name} subtitle={`📍 ${venue.location}`} onClose={onClose} width={520}>
            {slots === null ? (
                <div className={styles.slotSkeleton} />
            ) : days.length === 0 ? (
                <div className={styles.modalEmpty}>
                    <div className={styles.emptyIcon} aria-hidden="true">🗓️</div>
                    <p>No free slots yet. Check back later.</p>
                </div>
            ) : (
                <div className={styles.days}>
                    {days.map(day => (
                        <section key={day.key}>
                            <h3 className={styles.dayLabel}>{day.label}</h3>
                            <div className={styles.slotGrid}>
                                {day.slots.map(slot => (
                                    <button
                                        key={slot.id}
                                        type="button"
                                        className={`${styles.slot} ${selectedSlot?.id === slot.id ? styles.slotSelected : ''}`}
                                        aria-pressed={selectedSlot?.id === slot.id}
                                        onClick={() => setSelectedSlot(slot)}
                                    >
                                        {formatTimeRange(slot.start_time, slot.end_time)}
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            <div className={styles.bookingFooter}>
                <span className={styles.bookingSummary}>
                    {selectedSlot
                        ? <>Selected: <strong>{formatTimeRange(selectedSlot.start_time, selectedSlot.end_time)}</strong> · <strong>{formatMoney(slotPrice(venue, selectedSlot))}</strong></>
                        : 'Pick a time that suits you'}
                </span>
                <button className="btn btn-primary" disabled={!selectedSlot || submitting} onClick={handleConfirm}>
                    {submitting ? 'Booking…' : 'Book'}
                </button>
            </div>
        </Modal>
    );
};

const ConfirmDeleteModal = ({ venue, onClose, onDeleted }) => {
    const toast = useToast();
    const [submitting, setSubmitting] = useState(false);

    const handleDelete = () => {
        setSubmitting(true);
        apiFetch(`/api/venue/delete/${venue.id}`, { method: 'DELETE', auth: true })
            .then(() => {
                toast('Venue deleted', 'success');
                onDeleted(venue.id);
            })
            .catch(err => {
                toast(err.message, 'error');
                setSubmitting(false);
            });
    };

    return (
        <Modal title="Delete venue?" onClose={onClose} width={420}>
            <p className={styles.confirmText}>
                "{venue.name}" will be deleted along with all its slots and bookings. This cannot be undone.
            </p>
            <div className={styles.formActions}>
                <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={submitting}>
                    {submitting ? 'Deleting…' : 'Delete'}
                </button>
            </div>
        </Modal>
    );
};

const MAX_CARD_AMENITIES = 4;

const VenueCard = ({ venue, isAdmin, saved, onToggleFavorite, onOpen, onBook, onEdit, onDelete, onSlots }) => {
    const amenities = (venue.amenities || []).filter(a => AMENITIES[a]);
    return (
        <li className={styles.card}>
            <div className={styles.coverWrap}>
            <button
                className={`${styles.cover} ${styles[venue.type] || ''} ${venue.photo_ids?.length ? styles.coverPhoto : ''}`}
                style={venue.photo_ids?.length ? { backgroundImage: `linear-gradient(180deg, rgba(15,23,42,0.35), rgba(15,23,42,0) 45%), url(${photoUrl(venue.photo_ids[0])})` } : undefined}
                onClick={() => onOpen(venue)}
                aria-label={`Open ${venue.name}`}
            >
                <span className={styles.coverIcon} aria-hidden="true">{VENUE_TYPE_ICONS[venue.type] || '🏟️'}</span>
                <span className={styles.coverBadge}>{venueTypeLabel(venue.type)}</span>
                {Number(venue.price_per_hour) > 0 && (
                    <span className={styles.coverPrice}>{formatMoney(venue.price_per_hour)}<small>/h</small></span>
                )}
            </button>
            {!isAdmin && (
                <span className={styles.coverHeart}>
                    <HeartButton saved={saved} onToggle={() => onToggleFavorite(venue.id)} venueName={venue.name} floating size={18} />
                </span>
            )}
            </div>
            <div className={styles.cardBody}>
                <h3 className={styles.cardTitle}>
                    <button className={styles.titleLink} onClick={() => onOpen(venue)}>{venue.name}</button>
                </h3>
                <p className={styles.cardLocation}>📍 {venue.location}</p>
                <p className={styles.cardRating}>
                    {venue.rating_count > 0 ? (
                        <>
                            <Stars value={Number(venue.rating_avg)} size={14} />
                            <strong>{Number(venue.rating_avg).toFixed(1)}</strong>
                            <span>({venue.rating_count})</span>
                        </>
                    ) : <span>No reviews yet</span>}
                </p>
                <div className={styles.cardFacts}>
                    <span className={styles.factChip}>{venue.indoor ? '🏠 Indoor' : '🌤️ Outdoor'}</span>
                    {venue.capacity && <span className={styles.factChip}>👥 {venue.capacity} players</span>}
                    {venue.surface && <span className={styles.factChip}>{venue.surface}</span>}
                </div>
                {venue.description && <p className={styles.cardDescription}>{venue.description}</p>}
                {amenities.length > 0 && (
                    <ul className={styles.cardAmenities} aria-label="Amenities">
                        {amenities.slice(0, MAX_CARD_AMENITIES).map(a => (
                            <li key={a} title={AMENITIES[a].label}>
                                <span aria-hidden="true">{AMENITIES[a].icon}</span>
                                <span className="sr-only">{AMENITIES[a].label}</span>
                            </li>
                        ))}
                        {amenities.length > MAX_CARD_AMENITIES && (
                            <li className={styles.moreAmenities}>+{amenities.length - MAX_CARD_AMENITIES}</li>
                        )}
                    </ul>
                )}
            </div>
            <div className={styles.cardFooter}>
                {isAdmin ? (
                    <>
                        <button className="btn btn-secondary btn-sm" onClick={() => onSlots(venue)}>Slots</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(venue)}>Edit</button>
                        <button className="btn btn-danger btn-sm" onClick={() => onDelete(venue)} aria-label={`Delete ${venue.name}`}>Delete</button>
                    </>
                ) : (
                    <>
                        <button className="btn btn-secondary" onClick={() => onOpen(venue)}>Details</button>
                        <button className={`btn btn-primary ${styles.grow}`} onClick={() => onBook(venue)}>Book</button>
                    </>
                )}
            </div>
        </li>
    );
};

const SAVED = 'saved'; // pseudo type filter for hearted venues

const VenueList = ({
    isUserLoggedIn, isAdmin, onRequireAuth, favorites = new Set(), onToggleFavorite = () => {},
    rebookVenueId, onRebookHandled, openVenueRequest, onOpenVenueHandled,
}) => {
    const toast = useToast();
    const [venues, setVenues] = useState(null); // null = loading
    const [loadError, setLoadError] = useState(false);
    const [typeFilter, setTypeFilter] = useState('');
    const [search, setSearch] = useState('');

    const [bookingVenue, setBookingVenue] = useState(null);
    const [bookingSlotId, setBookingSlotId] = useState(null);
    const [openVenueId, setOpenVenueId] = useState(null); // venue page
    const [detailsRefresh, setDetailsRefresh] = useState(0);
    const [editingVenue, setEditingVenue] = useState(null); // venue | 'new' | null
    const [deletingVenue, setDeletingVenue] = useState(null);
    const [slotsVenue, setSlotsVenue] = useState(null);
    const [photosVenue, setPhotosVenue] = useState(null);

    const loadVenues = useCallback(() => {
        setLoadError(false);
        setVenues(null);
        apiFetch('/api/venue/get_all')
            .then(setVenues)
            .catch(() => {
                setVenues([]);
                setLoadError(true);
            });
    }, []);

    useEffect(loadVenues, [loadVenues]);

    // Admins don't book — close any booking in progress
    useEffect(() => {
        if (isAdmin) setBookingVenue(null);
    }, [isAdmin]);

    // "Book again" from the profile: open that venue's booking dialog once venues are loaded
    useEffect(() => {
        if (!rebookVenueId || venues === null) return;
        const venue = venues.find(v => v.id === rebookVenueId);
        if (venue) setBookingVenue(venue);
        else toast('This venue is no longer available', 'error');
        onRebookHandled?.();
    }, [rebookVenueId, venues, toast, onRebookHandled]);

    // A saved venue clicked in the profile: open its page once venues are loaded
    useEffect(() => {
        if (!openVenueRequest || venues === null) return;
        if (venues.some(v => v.id === openVenueRequest)) setOpenVenueId(openVenueRequest);
        else toast('This venue is no longer available', 'error');
        onOpenVenueHandled?.();
    }, [openVenueRequest, venues, toast, onOpenVenueHandled]);

    const typeCounts = useMemo(() => {
        const counts = {};
        (venues || []).forEach(v => { counts[v.type] = (counts[v.type] || 0) + 1; });
        return counts;
    }, [venues]);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (venues || []).filter(v =>
            (!typeFilter || (typeFilter === SAVED ? favorites.has(v.id) : v.type === typeFilter))
            && (!q || v.name.toLowerCase().includes(q) || v.location.toLowerCase().includes(q))
        );
    }, [venues, typeFilter, search, favorites]);

    const handleBook = (venue, slotId = null) => {
        setBookingVenue(venue);
        setBookingSlotId(slotId);
        if (!isUserLoggedIn) {
            toast('Log in to book a venue');
            onRequireAuth();
        }
    };

    const handleSaved = (saved) => {
        setVenues(prev => (prev.some(v => v.id === saved.id)
            ? prev.map(v => (v.id === saved.id ? saved : v))
            : [...prev, saved]));
        setEditingVenue(null);
    };

    const handleDeleted = (id) => {
        setVenues(prev => prev.filter(v => v.id !== id));
        setDeletingVenue(null);
        if (openVenueId === id) setOpenVenueId(null);
    };

    const openVenue = (venue) => {
        setOpenVenueId(venue.id);
        window.scrollTo({ top: 0 });
    };
    const closeVenue = () => setOpenVenueId(null);

    const handleBooked = useCallback(() => {
        setBookingVenue(null);
        setBookingSlotId(null);
        setDetailsRefresh(n => n + 1); // the venue page reloads its availability
    }, []);

    const closeBooking = useCallback(() => {
        setBookingVenue(null);
        setBookingSlotId(null);
    }, []);
    const closeEditing = useCallback(() => setEditingVenue(null), []);
    const closeDeleting = useCallback(() => setDeletingVenue(null), []);
    const closePhotos = useCallback(() => setPhotosVenue(null), []);
    const savedCount = (venues || []).filter(v => favorites.has(v.id)).length;

    const closeSlots = useCallback(() => {
        setSlotsVenue(null);
        setDetailsRefresh(n => n + 1); // slots may have changed
    }, []);

    const total = venues?.length ?? 0;
    const openVenueData = openVenueId && venues?.find(v => v.id === openVenueId);

    const modals = (
        <>
            {bookingVenue && isUserLoggedIn && !isAdmin && (
                <BookingModal venue={bookingVenue} initialSlotId={bookingSlotId} onClose={closeBooking} onBooked={handleBooked} />
            )}
            {isAdmin && editingVenue && (
                <VenueFormModal
                    venue={editingVenue === 'new' ? null : editingVenue}
                    onClose={closeEditing}
                    onSaved={handleSaved}
                />
            )}
            {isAdmin && deletingVenue && (
                <ConfirmDeleteModal venue={deletingVenue} onClose={closeDeleting} onDeleted={handleDeleted} />
            )}
            {isAdmin && slotsVenue && <SlotManager venue={slotsVenue} onClose={closeSlots} />}
            {isAdmin && photosVenue && (
                <PhotoManager venue={photosVenue} onClose={closePhotos} onChanged={(updated) => {
                    setVenues(prev => prev.map(v => (v.id === updated.id ? updated : v)));
                    setPhotosVenue(updated);
                }} />
            )}
        </>
    );

    if (openVenueData) {
        return (
            <>
                <VenueDetails
                    venue={openVenueData}
                    isAdmin={isAdmin}
                    refreshKey={detailsRefresh}
                    saved={favorites.has(openVenueData.id)}
                    onToggleFavorite={onToggleFavorite}
                    onPhotos={setPhotosVenue}
                    onBack={closeVenue}
                    onBook={handleBook}
                    onEdit={setEditingVenue}
                    onSlots={setSlotsVenue}
                    onDelete={setDeletingVenue}
                />
                {modals}
            </>
        );
    }

    return (
        <div>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.title}>Sports venues</h1>
                    <p className={styles.subtitle}>
                        {isAdmin ? 'Manage venues and their slot schedules' : 'Pick a venue and book a time that suits you'}
                    </p>
                </div>
                {isAdmin && (
                    <button className="btn btn-primary" onClick={() => setEditingVenue('new')}>+ Add venue</button>
                )}
            </div>

            <div className={styles.toolbar}>
                <div className={styles.chips} role="group" aria-label="Filter by type">
                    <button
                        className={`${styles.chip} ${typeFilter === '' ? styles.chipActive : ''}`}
                        aria-pressed={typeFilter === ''}
                        onClick={() => setTypeFilter('')}
                    >
                        All <span className={styles.chipCount}>{total}</span>
                    </button>
                    {isUserLoggedIn && !isAdmin && savedCount > 0 && (
                        <button
                            className={`${styles.chip} ${typeFilter === SAVED ? styles.chipActive : ''}`}
                            aria-pressed={typeFilter === SAVED}
                            onClick={() => setTypeFilter(typeFilter === SAVED ? '' : SAVED)}
                        >
                            <span aria-hidden="true">♥</span> Saved <span className={styles.chipCount}>{savedCount}</span>
                        </button>
                    )}
                    {Object.keys(VENUE_TYPES).filter(type => typeCounts[type]).map(type => (
                        <button
                            key={type}
                            className={`${styles.chip} ${typeFilter === type ? styles.chipActive : ''}`}
                            aria-pressed={typeFilter === type}
                            onClick={() => setTypeFilter(type)}
                        >
                            <span aria-hidden="true">{VENUE_TYPE_ICONS[type]}</span> {venueTypeLabel(type)}
                            <span className={styles.chipCount}>{typeCounts[type]}</span>
                        </button>
                    ))}
                </div>
                <input
                    className={`input ${styles.search}`}
                    type="search"
                    placeholder="Search by name or address"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    aria-label="Search venues"
                />
            </div>

            {venues === null ? (
                <ul className={styles.grid} aria-busy="true">
                    {Array.from({ length: 6 }, (_, i) => <li key={i} className={styles.skeleton} />)}
                </ul>
            ) : loadError ? (
                <div className={styles.empty}>
                    <div className={styles.emptyIcon} aria-hidden="true">⚠️</div>
                    <h2>Failed to load venues</h2>
                    <p>Check that the server is running and try again.</p>
                    <button className="btn btn-secondary" onClick={loadVenues}>Try again</button>
                </div>
            ) : filtered.length === 0 ? (
                <div className={styles.empty}>
                    <div className={styles.emptyIcon} aria-hidden="true">🏟️</div>
                    <h2>{total === 0 ? 'No venues yet' : typeFilter === SAVED ? 'No saved venues' : 'Nothing found'}</h2>
                    <p>{total === 0 ? 'Once venues are added, they will show up here.' : 'Try a different filter or search query.'}</p>
                </div>
            ) : (
                <ul className={styles.grid}>
                    {filtered.map(venue => (
                        <VenueCard
                            key={venue.id}
                            venue={venue}
                            isAdmin={isAdmin}
                            saved={favorites.has(venue.id)}
                            onToggleFavorite={onToggleFavorite}
                            onOpen={openVenue}
                            onBook={handleBook}
                            onEdit={setEditingVenue}
                            onDelete={setDeletingVenue}
                            onSlots={setSlotsVenue}
                        />
                    ))}
                </ul>
            )}

            {modals}
        </div>
    );
};

export default VenueList;
