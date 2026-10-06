import React, { useState } from 'react';
import styles from './AuthForm.module.css';
import { apiFetch } from '../api';
import { useToast } from './Toast';

const EMPTY_REGISTER = { name: '', email: '', password: '', confirmPassword: '' };

const Field = ({ label, ...inputProps }) => (
    <label className="field">
        <span className="field-label">{label}</span>
        <input className="input" {...inputProps} />
    </label>
);

// Login / sign-up / forgot-password form. mode: 'login' | 'register' | 'forgot'
const AuthForm = ({ mode, onModeChange, onLogin }) => {
    const toast = useToast();
    const [loginData, setLoginData] = useState({ email: '', password: '' });
    const [registerData, setRegisterData] = useState(EMPTY_REGISTER);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [resetSentTo, setResetSentTo] = useState('');

    const switchMode = (next) => {
        setError('');
        onModeChange(next);
    };

    const handleLoginChange = (e) => {
        setLoginData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleRegisterChange = (e) => {
        setRegisterData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleLogin = (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        apiFetch('/api/user/login', { method: 'POST', body: loginData })
            .then(data => {
                toast('You are logged in', 'success');
                onLogin(data.token);
            })
            .catch(err => setError(err.status === 401 ? 'Invalid email or password' : err.message))
            .finally(() => setSubmitting(false));
    };

    const handleRegister = (e) => {
        e.preventDefault();
        if (registerData.password !== registerData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }
        setError('');
        setSubmitting(true);
        apiFetch('/api/user/register', {
            method: 'POST',
            body: {
                name: registerData.name,
                email: registerData.email,
                password: registerData.password,
            },
        })
            .then(() => {
                toast('Account created — now log in', 'success');
                setLoginData({ email: registerData.email, password: '' });
                setRegisterData(EMPTY_REGISTER);
                switchMode('login');
            })
            .catch(err => setError(err.message))
            .finally(() => setSubmitting(false));
    };

    const handleForgot = (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        apiFetch('/api/user/password/forgot', { method: 'POST', body: { email: loginData.email } })
            .then(() => setResetSentTo(loginData.email))
            .catch(err => setError(err.message))
            .finally(() => setSubmitting(false));
    };

    if (mode === 'forgot') {
        return resetSentTo ? (
            <div className={styles.form}>
                <p className={styles.notice}>
                    If <strong>{resetSentTo}</strong> is registered, we have sent a link to choose a new password. It is valid for 1 hour.
                </p>
                <button type="button" className="btn btn-secondary btn-block" onClick={() => { setResetSentTo(''); switchMode('login'); }}>
                    Back to log in
                </button>
            </div>
        ) : (
            <form className={styles.form} onSubmit={handleForgot}>
                <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
                    value={loginData.email} onChange={handleLoginChange} required autoFocus />
                {error && <p className={styles.error}>{error}</p>}
                <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                    {submitting ? 'Sending…' : 'Send reset link'}
                </button>
                <button type="button" className={styles.linkButton} onClick={() => switchMode('login')}>Back to log in</button>
            </form>
        );
    }

    return (
        <div>
            <div className={styles.tabs} role="tablist">
                <button type="button" role="tab" aria-selected={mode === 'login'}
                    className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`}
                    onClick={() => switchMode('login')}>
                    Log in
                </button>
                <button type="button" role="tab" aria-selected={mode === 'register'}
                    className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`}
                    onClick={() => switchMode('register')}>
                    Sign up
                </button>
            </div>

            {mode === 'login' ? (
                <form className={styles.form} onSubmit={handleLogin}>
                    <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
                        value={loginData.email} onChange={handleLoginChange} required autoFocus />
                    <Field label="Password" name="password" type="password" autoComplete="current-password"
                        value={loginData.password} onChange={handleLoginChange} required />
                    <button type="button" className={styles.forgotLink} onClick={() => switchMode('forgot')}>Forgot password?</button>
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                        {submitting ? 'Logging in…' : 'Log in'}
                    </button>
                </form>
            ) : (
                <form className={styles.form} onSubmit={handleRegister}>
                    <Field label="Name" name="name" autoComplete="name" placeholder="Jane Doe"
                        value={registerData.name} onChange={handleRegisterChange} required autoFocus />
                    <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com"
                        value={registerData.email} onChange={handleRegisterChange} required />
                    <Field label="Password" name="password" type="password" autoComplete="new-password"
                        placeholder="At least 6 characters" minLength={6}
                        value={registerData.password} onChange={handleRegisterChange} required />
                    <Field label="Confirm password" name="confirmPassword" type="password" autoComplete="new-password"
                        value={registerData.confirmPassword} onChange={handleRegisterChange} required />
                    {error && <p className={styles.error}>{error}</p>}
                    <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                        {submitting ? 'Creating…' : 'Create account'}
                    </button>
                </form>
            )}
        </div>
    );
};

// Opened from the link in the password-reset email
export const ResetPasswordForm = ({ token, onDone }) => {
    const toast = useToast();
    const [passwords, setPasswords] = useState({ next: '', confirm: '' });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleChange = (e) => setPasswords(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const handleSubmit = (e) => {
        e.preventDefault();
        if (passwords.next !== passwords.confirm) {
            setError('Passwords do not match');
            return;
        }
        setError('');
        setSubmitting(true);
        apiFetch('/api/user/password/reset', { method: 'POST', body: { token, newPassword: passwords.next } })
            .then(() => {
                toast('Password updated — log in with the new one', 'success');
                onDone();
            })
            .catch(err => setError(err.message))
            .finally(() => setSubmitting(false));
    };

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <Field label="New password" name="next" type="password" autoComplete="new-password" placeholder="At least 6 characters"
                minLength={6} value={passwords.next} onChange={handleChange} required autoFocus />
            <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password"
                value={passwords.confirm} onChange={handleChange} required />
            {error && <p className={styles.error}>{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Saving…' : 'Set new password'}
            </button>
        </form>
    );
};

export default AuthForm;
