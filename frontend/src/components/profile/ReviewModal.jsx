import React, { useState } from 'react';
import styles from './profile.module.css';
import { apiFetch } from '../../api';
import { formatDay, formatTimeRange } from '../../format';
import Modal from '../Modal';
import { StarInput } from '../Stars';
import { useToast } from '../Toast';

// Rate a played game (creates or updates the review of that booking)
const ReviewModal = ({ booking, onClose, onSaved }) => {
    const toast = useToast();
    const [rating, setRating] = useState(booking.review?.rating || 0);
    const [comment, setComment] = useState(booking.review?.comment || '');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!rating) {
            setError('Pick 1 to 5 stars');
            return;
        }
        setError('');
        setSubmitting(true);
        apiFetch(`/api/bookings/${booking.id}/review`, { method: 'POST', auth: true, body: { rating, comment } })
            .then(review => {
                toast(booking.review ? 'Review updated' : 'Thanks for your review!', 'success');
                onSaved(booking.id, { rating: review.rating, comment: review.comment });
            })
            .catch(err => setError(err.message))
            .finally(() => setSubmitting(false));
    };

    return (
        <Modal
            title={booking.review ? 'Edit your review' : 'How was your game?'}
            subtitle={`${booking.venue?.name} · ${formatDay(booking.start_time)}, ${formatTimeRange(booking.start_time, booking.end_time)}`}
            onClose={onClose}
            width={460}
        >
            <form className={styles.editForm} onSubmit={handleSubmit}>
                <StarInput value={rating} onChange={setRating} />
                <label className="field">
                    <span className="field-label">Comment <span className={styles.optional}>— optional</span></span>
                    <textarea
                        className="input"
                        rows={4}
                        maxLength={1000}
                        placeholder="Surface, lighting, changing rooms, staff…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                    />
                </label>
                {error && <p className={styles.formError}>{error}</p>}
                <div className={styles.formActions}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Saving…' : booking.review ? 'Update review' : 'Post review'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default ReviewModal;
