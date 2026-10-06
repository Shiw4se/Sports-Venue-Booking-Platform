import React, { useEffect } from 'react';

// Modal dialog: closes on Esc, backdrop click or the close button
const Modal = ({ title, subtitle, onClose, children, width }) => {
    useEffect(() => {
        const onKey = (e) => e.key === 'Escape' && onClose();
        document.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [onClose]);

    return (
        <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { maxWidth: width } : undefined}>
                <div className="modal-header">
                    <div>
                        <h2 className="modal-title">{title}</h2>
                        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
                    </div>
                    <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
                </div>
                <div className="modal-body">{children}</div>
            </div>
        </div>
    );
};

export default Modal;
