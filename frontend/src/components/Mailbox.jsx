import React, { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import styles from './Mailbox.module.css';
import { apiFetch } from '../api';
import { useToast } from './Toast';

const TYPE_LABELS = {
    welcome: 'Welcome',
    booking_confirmed: 'Confirmation',
    booking_cancelled: 'Cancellation',
    booking_reminder: 'Reminder',
    password_reset: 'Password reset',
};

// Admin view of every email the notification service produced.
// Without SMTP configured this is where emails "arrive" (dev mailbox).
const Mailbox = () => {
    const toast = useToast();
    const [emails, setEmails] = useState(null);
    const [total, setTotal] = useState(0);
    const [selected, setSelected] = useState(null);

    const load = useCallback(() => {
        apiFetch('/api/admin/emails?limit=100', { auth: true })
            .then(data => {
                setEmails(data.emails);
                setTotal(data.total);
            })
            .catch(err => {
                setEmails([]);
                toast(err.message, 'error');
            });
    }, [toast]);

    useEffect(load, [load]);

    const open = (id) => {
        apiFetch(`/api/admin/emails/${id}`, { auth: true })
            .then(setSelected)
            .catch(err => toast(err.message, 'error'));
    };

    // Show the newest email right away
    useEffect(() => {
        if (emails?.length && !selected) open(emails[0].id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [emails]);

    return (
        <div>
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>Emails</h1>
                    <p className={styles.subtitle}>
                        Everything the notification service sent: confirmations, reminders, password resets.
                        Without <code>SMTP_URL</code> emails stay here instead of being delivered.
                    </p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={load}>Refresh</button>
            </div>

            {emails === null ? (
                <div className={styles.skeleton} />
            ) : emails.length === 0 ? (
                <div className={styles.empty}>
                    <div className={styles.emptyIcon} aria-hidden="true">📭</div>
                    <p>No emails yet. Register, book or cancel a game and they will appear here.</p>
                </div>
            ) : (
                <div className={styles.layout}>
                    <ul className={styles.list} aria-label={`${total} emails`}>
                        {emails.map(m => (
                            <li key={m.id}>
                                <button
                                    className={`${styles.item} ${selected?.id === m.id ? styles.itemActive : ''}`}
                                    onClick={() => open(m.id)}
                                >
                                    <span className={styles.itemTop}>
                                        <span className={styles.itemTo}>{m.to_email}</span>
                                        <span className={styles.itemTime}>{format(new Date(m.created_at), 'MMM d, HH:mm')}</span>
                                    </span>
                                    <span className={styles.itemSubject}>{m.subject}</span>
                                    <span className={styles.itemBadges}>
                                        <span className="badge">{TYPE_LABELS[m.type] || m.type}</span>
                                        {m.status !== 'stored' && (
                                            <span className={`badge ${m.status === 'sent' ? 'badge-success' : ''}`}>{m.status}</span>
                                        )}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>

                    <section className={styles.preview} aria-live="polite">
                        {selected ? (
                            <>
                                <dl className={styles.meta}>
                                    <div><dt>To</dt><dd>{selected.to_email}</dd></div>
                                    <div><dt>Subject</dt><dd>{selected.subject}</dd></div>
                                    <div><dt>Date</dt><dd>{format(new Date(selected.created_at), 'EEEE, MMMM d, HH:mm')}</dd></div>
                                    {selected.error && <div><dt>Error</dt><dd className={styles.error}>{selected.error}</dd></div>}
                                </dl>
                                {/* sandbox without allow-scripts: the email HTML cannot run code */}
                                <iframe className={styles.frame} title={selected.subject} srcDoc={selected.html} sandbox="allow-popups allow-popups-to-escape-sandbox" />
                            </>
                        ) : (
                            <p className={styles.muted}>Select an email</p>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
};

export default Mailbox;
