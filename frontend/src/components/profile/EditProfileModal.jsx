import React, { useRef, useState } from 'react';
import styles from './profile.module.css';
import { apiFetch } from '../../api';
import Avatar, { AVATAR_COLORS } from '../Avatar';
import Modal from '../Modal';
import { useToast } from '../Toast';
import { resizeToAvatar } from '../../imageResize';

const EditProfileModal = ({ user, onClose, onSaved }) => {
    const toast = useToast();
    const [name, setName] = useState(user.name || '');
    const [color, setColor] = useState(user.avatar_color || '');
    const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
    // Photo: keep the current one, replace it with a new data URL, or remove it
    const [photo, setPhoto] = useState({ mode: 'keep', dataUrl: null });
    const [processingPhoto, setProcessingPhoto] = useState(false);
    const fileInput = useRef(null);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const changingPassword = Boolean(passwords.current || passwords.next || passwords.confirm);
    const setPassword = (e) => setPasswords(prev => ({ ...prev, [e.target.name]: e.target.value }));

    const previewSrc = photo.mode === 'new' ? photo.dataUrl : photo.mode === 'remove' ? null : user.avatar_url;

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow picking the same file again
        if (!file) return;
        setError('');
        setProcessingPhoto(true);
        try {
            setPhoto({ mode: 'new', dataUrl: await resizeToAvatar(file) });
        } catch (err) {
            setError(err.message);
        } finally {
            setProcessingPhoto(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (changingPassword && passwords.next !== passwords.confirm) {
            setError('New passwords do not match');
            return;
        }

        setSubmitting(true);
        try {
            let profile = await apiFetch('/api/user/profile', {
                method: 'PUT',
                auth: true,
                body: { name, avatar_color: color || null },
            });
            if (photo.mode === 'new') {
                profile = await apiFetch('/api/user/avatar', { method: 'PUT', auth: true, body: { dataUrl: photo.dataUrl } });
            } else if (photo.mode === 'remove') {
                profile = await apiFetch('/api/user/avatar', { method: 'DELETE', auth: true });
            }
            if (changingPassword) {
                await apiFetch('/api/user/password', {
                    method: 'PUT',
                    auth: true,
                    body: { currentPassword: passwords.current, newPassword: passwords.next },
                });
            }
            toast(changingPassword ? 'Profile and password updated' : 'Profile updated', 'success');
            onSaved(profile);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Modal title="Edit profile" onClose={onClose} width={480}>
            <form className={styles.editForm} onSubmit={handleSubmit}>
                <div className={styles.editPreview}>
                    <Avatar name={name} email={user.email} color={color || null} src={previewSrc} size={72} />
                    <div className={styles.photoControls}>
                        <p className={styles.editName}>{name || 'Your name'}</p>
                        <p className={styles.muted}>{user.email}</p>
                        <div className={styles.photoButtons}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInput.current?.click()} disabled={processingPhoto}>
                                {processingPhoto ? 'Processing…' : previewSrc ? 'Change photo' : 'Upload photo'}
                            </button>
                            {previewSrc && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhoto({ mode: 'remove', dataUrl: null })}>
                                    Remove
                                </button>
                            )}
                            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={handleFile} />
                        </div>
                    </div>
                </div>

                <label className="field">
                    <span className="field-label">Name</span>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
                </label>

                <fieldset className={styles.colorField}>
                    <legend className="field-label">
                        Avatar color {previewSrc && <span className={styles.optional}>— shown when there is no photo</span>}
                    </legend>
                    <div className={styles.swatches}>
                        <label className={`${styles.swatch} ${styles.swatchDefault} ${!color ? styles.swatchSelected : ''}`} title="Default">
                            <input type="radio" name="color" value="" checked={!color} onChange={() => setColor('')} />
                        </label>
                        {AVATAR_COLORS.map(c => (
                            <label key={c} className={`${styles.swatch} ${color === c ? styles.swatchSelected : ''}`} style={{ background: c }} title={c}>
                                <input type="radio" name="color" value={c} checked={color === c} onChange={() => setColor(c)} />
                            </label>
                        ))}
                    </div>
                </fieldset>

                <fieldset className={styles.passwordField}>
                    <legend className="field-label">Change password <span className={styles.optional}>— optional</span></legend>
                    <input className="input" type="password" name="current" placeholder="Current password" autoComplete="current-password"
                        value={passwords.current} onChange={setPassword} required={changingPassword} />
                    <input className="input" type="password" name="next" placeholder="New password (at least 6 characters)" autoComplete="new-password"
                        minLength={6} value={passwords.next} onChange={setPassword} required={changingPassword} />
                    <input className="input" type="password" name="confirm" placeholder="Confirm new password" autoComplete="new-password"
                        value={passwords.confirm} onChange={setPassword} required={changingPassword} />
                </fieldset>

                {error && <p className={styles.formError}>{error}</p>}

                <div className={styles.formActions}>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={submitting}>
                        {submitting ? 'Saving…' : 'Save changes'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export default EditProfileModal;
