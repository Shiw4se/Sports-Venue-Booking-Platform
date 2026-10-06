import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import styles from './VenueList.module.css';
import { apiFetch } from '../api';
import { formatTimeRange, groupSlotsByDay } from '../format';
import { expandSchedule, WEEKDAYS } from '../slotSchedule';
import Modal from './Modal';
import { useToast } from './Toast';

const today = () => format(new Date(), 'yyyy-MM-dd');
const DURATIONS = [60, 90, 120];

// Admin management of a venue's slots: single slots, recurring schedules, list and delete
const SlotManager = ({ venue, onClose }) => {
    const toast = useToast();
    const [slots, setSlots] = useState(null);
    const [mode, setMode] = useState('repeat'); // 'single' | 'repeat'
    const [form, setForm] = useState({ date: today(), start: '18:00', end: '19:30' });
    const [schedule, setSchedule] = useState({
        fromDate: today(), weeks: 4, weekdays: [1, 2, 3, 4, 5], startTime: '18:00', endTime: '22:00', durationMinutes: 60,
    });
    const [submitting, setSubmitting] = useState(false);

    const loadSlots = useCallback(() => {
        apiFetch(`/api/venue/find_by_id/${venue.id}`)
            .then(setSlots)
            .catch(err => {
                setSlots([]);
                toast(err.message, 'error');
            });
    }, [venue.id, toast]);

    useEffect(loadSlots, [loadSlots]);

    const days = useMemo(() => {
        const now = new Date();
        return groupSlotsByDay((slots || []).filter(s => new Date(s.end_time) > now));
    }, [slots]);

    const planned = useMemo(() => expandSchedule(schedule), [schedule]);

    const handleChange = (e) => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    const handleSchedule = (e) => {
        const { name, value } = e.target;
        setSchedule(prev => ({ ...prev, [name]: ['weeks', 'durationMinutes'].includes(name) ? Number(value) : value }));
    };
    const toggleDay = (day) => setSchedule(prev => ({
        ...prev,
        weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter(d => d !== day) : [...prev.weekdays, day],
    }));

    const handleAdd = (e) => {
        e.preventDefault();
        const start = new Date(`${form.date}T${form.start}`);
        const end = new Date(`${form.date}T${form.end}`);
        if (end <= start) {
            toast('End time must be after start time', 'error');
            return;
        }

        setSubmitting(true);
        apiFetch(`/api/venue/createslot/${venue.id}`, {
            method: 'POST',
            auth: true,
            body: { start_time: start.toISOString(), end_time: end.toISOString() },
        })
            .then(slot => {
                setSlots(prev => [...(prev || []), slot]);
                toast('Slot added', 'success');
            })
            .catch(err => toast(err.message, 'error'))
            .finally(() => setSubmitting(false));
    };

    const handleRepeat = (e) => {
        e.preventDefault();
        if (planned.length === 0) {
            toast('The schedule does not produce any future slots', 'error');
            return;
        }
        setSubmitting(true);
        apiFetch(`/api/venue/createslots/${venue.id}`, { method: 'POST', auth: true, body: { slots: planned } })
            .then(({ created, skipped }) => {
                toast(`Created ${created} slot${created === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} overlapping` : ''}`, 'success');
                loadSlots();
            })
            .catch(err => toast(err.message, 'error'))
            .finally(() => setSubmitting(false));
    };

    const handleDelete = (slot) => {
        apiFetch(`/api/venue/deleteslot/${slot.id}`, { method: 'DELETE', auth: true })
            .then(() => setSlots(prev => prev.filter(s => s.id !== slot.id)))
            .catch(err => toast(err.message, 'error'));
    };

    return (
        <Modal title="Slot schedule" subtitle={venue.name} onClose={onClose} width={600}>
            <div className={styles.modeTabs} role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'repeat'}
                    className={`${styles.modeTab} ${mode === 'repeat' ? styles.modeTabActive : ''}`} onClick={() => setMode('repeat')}>
                    Repeat weekly
                </button>
                <button type="button" role="tab" aria-selected={mode === 'single'}
                    className={`${styles.modeTab} ${mode === 'single' ? styles.modeTabActive : ''}`} onClick={() => setMode('single')}>
                    Single slot
                </button>
            </div>

            {mode === 'single' ? (
                <form className={styles.slotForm} onSubmit={handleAdd}>
                    <label className="field">
                        <span className="field-label">Date</span>
                        <input className="input" type="date" name="date" min={today()} value={form.date} onChange={handleChange} required />
                    </label>
                    <label className="field">
                        <span className="field-label">Start</span>
                        <input className="input" type="time" name="start" value={form.start} onChange={handleChange} required />
                    </label>
                    <label className="field">
                        <span className="field-label">End</span>
                        <input className="input" type="time" name="end" value={form.end} onChange={handleChange} required />
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>Add</button>
                </form>
            ) : (
                <form className={styles.repeatForm} onSubmit={handleRepeat}>
                    <fieldset className={styles.weekdayField}>
                        <legend className="field-label">Days</legend>
                        <div className={styles.weekdays}>
                            {WEEKDAYS.map(({ day, label }) => (
                                <button
                                    key={day}
                                    type="button"
                                    aria-pressed={schedule.weekdays.includes(day)}
                                    className={`${styles.weekday} ${schedule.weekdays.includes(day) ? styles.weekdayOn : ''}`}
                                    onClick={() => toggleDay(day)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </fieldset>
                    <div className={styles.repeatGrid}>
                        <label className="field">
                            <span className="field-label">From</span>
                            <input className="input" type="time" name="startTime" value={schedule.startTime} onChange={handleSchedule} required />
                        </label>
                        <label className="field">
                            <span className="field-label">Until</span>
                            <input className="input" type="time" name="endTime" value={schedule.endTime} onChange={handleSchedule} required />
                        </label>
                        <label className="field">
                            <span className="field-label">Slot length</span>
                            <select className="input" name="durationMinutes" value={schedule.durationMinutes} onChange={handleSchedule}>
                                {DURATIONS.map(d => <option key={d} value={d}>{d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`}</option>)}
                            </select>
                        </label>
                        <label className="field">
                            <span className="field-label">Starting</span>
                            <input className="input" type="date" name="fromDate" min={today()} value={schedule.fromDate} onChange={handleSchedule} required />
                        </label>
                        <label className="field">
                            <span className="field-label">For</span>
                            <select className="input" name="weeks" value={schedule.weeks} onChange={handleSchedule}>
                                {[1, 2, 3, 4, 6, 8, 12].map(w => <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>)}
                            </select>
                        </label>
                    </div>
                    <div className={styles.repeatFooter}>
                        <span className={styles.repeatSummary}>
                            {planned.length
                                ? <><strong>{planned.length}</strong> slots · overlaps with existing ones are skipped</>
                                : 'No future slots for these settings'}
                        </span>
                        <button type="submit" className="btn btn-primary" disabled={submitting || planned.length === 0}>
                            {submitting ? 'Creating…' : `Create ${planned.length || ''} slots`}
                        </button>
                    </div>
                </form>
            )}

            {slots === null ? (
                <div className={styles.slotSkeleton} />
            ) : days.length === 0 ? (
                <p className={styles.modalEmpty}>No upcoming slots — add the first ones.</p>
            ) : (
                <div className={styles.days}>
                    {days.map(day => (
                        <section key={day.key}>
                            <h3 className={styles.dayLabel}>{day.label}</h3>
                            <ul className={styles.adminSlots}>
                                {day.slots.map(slot => (
                                    <li key={slot.id} className={styles.adminSlot}>
                                        <span className={styles.adminSlotTime}>{formatTimeRange(slot.start_time, slot.end_time)}</span>
                                        {slot.is_available
                                            ? <span className="badge badge-success">Available</span>
                                            : <span className="badge">Booked</span>}
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => handleDelete(slot)}
                                            disabled={!slot.is_available}
                                            title={slot.is_available ? 'Delete slot' : 'A booked slot cannot be deleted'}
                                        >
                                            Delete
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}
        </Modal>
    );
};

export default SlotManager;
