import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './App.module.css';
import VenueList from './components/VenueList';
import UserProfile from './components/UserProfile';
import Dashboard from './components/Dashboard';
import Mailbox from './components/Mailbox';
import AuthForm, { ResetPasswordForm } from './components/AuthForm';
import Modal from './components/Modal';
import Avatar from './components/Avatar';
import { ToastProvider, useToast } from './components/Toast';
import { apiFetch, AUTH_EXPIRED_EVENT, clearToken, decodeSession, getToken, saveToken } from './api';

const NAV = [
    { id: 'venues', label: 'Venues' },
    { id: 'profile', label: 'My profile' },
    { id: 'dashboard', label: 'Dashboard', adminOnly: true },
    { id: 'emails', label: 'Emails', adminOnly: true },
];

// Links in emails and Stripe redirects: ?view=profile opens the profile, ?reset=<token> opens
// "choose a new password", ?checkout=success&session_id=… / ?checkout=cancelled come back from Stripe.
// Read once on load, then removed from the address bar.
function readLinkParams() {
    const params = new URLSearchParams(window.location.search);
    const checkout = ['success', 'cancelled'].includes(params.get('checkout')) ? params.get('checkout') : null;
    const link = {
        view: params.get('view') === 'profile' || checkout ? 'profile' : 'venues',
        resetToken: params.get('reset'),
        checkout,
        sessionId: params.get('session_id'),
    };
    if (params.has('view') || params.has('reset') || params.has('checkout')) {
        window.history.replaceState(null, '', window.location.pathname);
    }
    return link;
}

// What to tell the player after Stripe sent them back
const CHECKOUT_MESSAGES = {
    paid: ['Payment received — your booking is confirmed', 'success'],
    pending: ['Payment is being processed; the booking will be confirmed shortly', 'info'],
    expired: ['The reservation expired before the payment completed', 'error'],
    refunded: ['The reservation had expired, so the payment was refunded in full', 'error'],
};

function AppShell() {
    const toast = useToast();
    const [link] = useState(readLinkParams);
    const [token, setToken] = useState(getToken);
    const session = useMemo(() => decodeSession(token), [token]);
    const isUserLoggedIn = !!session;
    const isAdmin = session?.role === 'admin';

    const [view, setView] = useState(link.view); // 'venues' | 'profile' | 'dashboard' | 'emails'
    const [authMode, setAuthMode] = useState(null); // null | 'login' | 'register' | 'forgot'
    const [resetToken, setResetToken] = useState(link.resetToken);
    const [profile, setProfile] = useState(null); // name / avatar for the header
    const [favorites, setFavorites] = useState(() => new Set());
    const [rebookVenueId, setRebookVenueId] = useState(null);
    const [openVenueRequest, setOpenVenueRequest] = useState(null);
    const [profileRefresh, setProfileRefresh] = useState(0); // bumps after a payment check so bookings reload

    const handleLogin = (newToken) => {
        saveToken(newToken);
        setToken(newToken);
        setAuthMode(null);
    };

    const handleLogout = useCallback(() => {
        clearToken();
        setToken(null);
        setView('venues');
    }, []);

    const closeAuth = useCallback(() => setAuthMode(null), []);
    const closeReset = useCallback(() => setResetToken(null), []);

    // Log out on an expired token in localStorage or a 401 from the server
    useEffect(() => {
        if (token && !session) handleLogout();
    }, [token, session, handleLogout]);

    useEffect(() => {
        if (!isUserLoggedIn) {
            setProfile(null);
            setFavorites(new Set());
            return;
        }
        apiFetch('/api/user/profile', { auth: true }).then(setProfile).catch(() => {});
        apiFetch('/api/user/favorites', { auth: true }).then(ids => setFavorites(new Set(ids))).catch(() => {});
    }, [isUserLoggedIn, token]);

    // Heart on a venue: optimistic update, then the server's list wins
    const toggleFavorite = useCallback((venueId) => {
        if (!isUserLoggedIn) {
            toast('Log in to save venues');
            setAuthMode('login');
            return;
        }
        const saved = favorites.has(venueId);
        setFavorites(prev => {
            const next = new Set(prev);
            if (saved) next.delete(venueId);
            else next.add(venueId);
            return next;
        });
        apiFetch(`/api/user/favorites/${venueId}`, { method: saved ? 'DELETE' : 'PUT', auth: true })
            .then(ids => setFavorites(new Set(ids)))
            .catch(err => {
                toast(err.message, 'error');
                apiFetch('/api/user/favorites', { auth: true }).then(ids => setFavorites(new Set(ids))).catch(() => {});
            });
    }, [favorites, isUserLoggedIn, toast]);

    // Back from Stripe Checkout: confirm the booking right away instead of waiting for the webhook
    useEffect(() => {
        if (!link.checkout) return;
        if (!isUserLoggedIn) {
            toast('Log in to see your booking');
            setAuthMode('login');
            return;
        }
        if (link.checkout === 'cancelled') {
            toast('Payment cancelled — the slot is held for 30 minutes, you can pay from your profile');
            return;
        }
        if (!link.sessionId) return;
        apiFetch(`/api/payments/verify?session_id=${encodeURIComponent(link.sessionId)}`, { auth: true })
            .then(({ paymentStatus }) => {
                const [message, type] = CHECKOUT_MESSAGES[paymentStatus] || CHECKOUT_MESSAGES.pending;
                toast(message, type);
            })
            .catch(err => toast(err.message, 'error'))
            .finally(() => setProfileRefresh(n => n + 1));
        // runs once per page load for the link that opened it
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isUserLoggedIn]);

    // "Book again" from the profile opens the booking dialog of that venue
    const handleBookAgain = (venueId) => {
        setRebookVenueId(venueId);
        setView('venues');
    };
    const clearRebook = useCallback(() => setRebookVenueId(null), []);

    // A saved venue in the profile opens its venue page
    const handleOpenVenue = (venueId) => {
        setOpenVenueRequest(venueId);
        setView('venues');
    };
    const clearOpenVenue = useCallback(() => setOpenVenueRequest(null), []);

    useEffect(() => {
        window.addEventListener(AUTH_EXPIRED_EVENT, handleLogout);
        return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleLogout);
    }, [handleLogout]);

    const authTitles = {
        login: ['Log in', 'Welcome back'],
        register: ['Sign up', 'Create an account to book venues'],
        forgot: ['Reset password', 'We will email you a link to choose a new one'],
    };

    return (
        <>
            <header className={styles.header}>
                <div className={styles.headerInner}>
                    <button className={styles.brand} onClick={() => setView('venues')}>
                        <span className={styles.brandMark} aria-hidden="true">S</span>
                        SportBook
                    </button>

                    <nav className={styles.nav}>
                        {NAV.filter(item => !item.adminOnly || isAdmin).map(item => (
                            <button
                                key={item.id}
                                className={`${styles.navItem} ${view === item.id ? styles.navItemActive : ''}`}
                                onClick={() => setView(item.id)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className={styles.account}>
                        {isUserLoggedIn ? (
                            <>
                                <button className={styles.user} onClick={() => setView('profile')} title="My profile">
                                    <Avatar name={profile?.name} email={session.email} color={profile?.avatar_color} src={profile?.avatar_url} size={32} />
                                    <span className={styles.userEmail}>{profile?.name || session.email}</span>
                                    {isAdmin && <span className="badge badge-primary">Admin</span>}
                                </button>
                                <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Log out</button>
                            </>
                        ) : (
                            <>
                                <button className="btn btn-ghost btn-sm" onClick={() => setAuthMode('login')}>Log in</button>
                                <button className="btn btn-primary btn-sm" onClick={() => setAuthMode('register')}>Sign up</button>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main className={styles.main}>
                {view === 'venues' && (
                    <VenueList
                        isUserLoggedIn={isUserLoggedIn}
                        isAdmin={isAdmin}
                        onRequireAuth={() => setAuthMode('login')}
                        favorites={favorites}
                        onToggleFavorite={toggleFavorite}
                        rebookVenueId={rebookVenueId}
                        onRebookHandled={clearRebook}
                        openVenueRequest={openVenueRequest}
                        onOpenVenueHandled={clearOpenVenue}
                    />
                )}

                {view === 'dashboard' && isAdmin && <Dashboard />}
                {view === 'emails' && isAdmin && <Mailbox />}

                {view === 'profile' && (
                    isUserLoggedIn ? (
                        <UserProfile
                            onBrowse={() => setView('venues')}
                            onBookAgain={handleBookAgain}
                            onOpenVenue={handleOpenVenue}
                            onProfileUpdated={setProfile}
                            favorites={favorites}
                            onToggleFavorite={toggleFavorite}
                            refreshKey={profileRefresh}
                        />
                    ) : (
                        <div className={styles.locked}>
                            <div className={styles.lockedIcon} aria-hidden="true">🔒</div>
                            <h2>Log in to see your bookings</h2>
                            <p>Your booking history is kept here.</p>
                            <button className="btn btn-primary" onClick={() => setAuthMode('login')}>Log in</button>
                        </div>
                    )
                )}
            </main>

            {authMode && !isUserLoggedIn && (
                <Modal title={authTitles[authMode][0]} subtitle={authTitles[authMode][1]} onClose={closeAuth} width={420}>
                    <AuthForm mode={authMode} onModeChange={setAuthMode} onLogin={handleLogin} />
                </Modal>
            )}

            {resetToken && (
                <Modal title="Choose a new password" subtitle="The link from your email is valid for 1 hour" onClose={closeReset} width={420}>
                    <ResetPasswordForm
                        token={resetToken}
                        onDone={() => {
                            setResetToken(null);
                            if (!isUserLoggedIn) setAuthMode('login');
                        }}
                    />
                </Modal>
            )}
        </>
    );
}

function App() {
    return (
        <ToastProvider>
            <AppShell />
        </ToastProvider>
    );
}

export default App;
