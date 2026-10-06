import React, { useRef, useState } from 'react';
import styles from './VenueDetails.module.css';
import { apiFetch } from '../api';
import { resizeVenuePhoto } from '../imageResize';
import Modal from './Modal';
import { useToast } from './Toast';

const MAX_PHOTOS = 8;
export const photoUrl = (id) => `/api/venue/photos/${id}`;

// Admin: upload (resized in the browser) and delete gallery photos of a venue
const PhotoManager = ({ venue, onClose, onChanged }) => {
    const toast = useToast();
    const fileInput = useRef(null);
    const [photoIds, setPhotoIds] = useState(venue.photo_ids || []);
    const [progress, setProgress] = useState(null); // "Uploading 2 of 3…"

    const apply = (updated) => {
        setPhotoIds(updated.photo_ids);
        onChanged(updated);
    };

    const handleFiles = async (e) => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        const room = MAX_PHOTOS - photoIds.length;
        if (files.length > room) toast(`Only ${room} more photo${room === 1 ? '' : 's'} fit — extra files were skipped`, 'error');

        const batch = files.slice(0, room);
        for (let i = 0; i < batch.length; i++) {
            setProgress(`Uploading ${i + 1} of ${batch.length}…`);
            try {
                const dataUrl = await resizeVenuePhoto(batch[i]);
                apply(await apiFetch(`/api/venue/${venue.id}/photos`, { method: 'POST', auth: true, body: { dataUrl } }));
            } catch (err) {
                toast(`${batch[i].name}: ${err.message}`, 'error');
            }
        }
        setProgress(null);
        if (batch.length) toast('Photos updated', 'success');
    };

    const remove = (id) => {
        apiFetch(`/api/venue/photos/${id}`, { method: 'DELETE', auth: true })
            .then(apply)
            .catch(err => toast(err.message, 'error'));
    };

    return (
        <Modal title="Venue photos" subtitle={`${venue.name} · ${photoIds.length} of ${MAX_PHOTOS}`} onClose={onClose} width={640}>
            <p className={styles.photoHint}>
                The first photo is used as the cover. Photos are resized to 1600&nbsp;px in your browser before upload.
            </p>
            <ul className={styles.photoGrid}>
                {photoIds.map((id, i) => (
                    <li key={id} className={styles.photoTile}>
                        <img src={photoUrl(id)} alt={`${venue.name}, ${i + 1} of ${photoIds.length}`} />
                        {i === 0 && <span className={styles.coverTag}>Cover</span>}
                        <button className={styles.photoDelete} onClick={() => remove(id)} aria-label={`Delete photo ${i + 1}`}>×</button>
                    </li>
                ))}
                {photoIds.length < MAX_PHOTOS && (
                    <li>
                        <button className={styles.photoAdd} onClick={() => fileInput.current?.click()} disabled={Boolean(progress)}>
                            <span aria-hidden="true">＋</span>
                            {progress || 'Add photos'}
                        </button>
                    </li>
                )}
            </ul>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={handleFiles} />
        </Modal>
    );
};

export default PhotoManager;
