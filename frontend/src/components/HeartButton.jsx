import React from 'react';

// Save / unsave a venue. "floating" = round white button on top of a photo or gradient.
const HeartButton = ({ saved, onToggle, venueName, floating = false, size = 20 }) => (
    <button
        type="button"
        aria-pressed={saved}
        aria-label={saved ? `Remove ${venueName} from saved venues` : `Save ${venueName}`}
        title={saved ? 'Saved' : 'Save'}
        onClick={(e) => {
            e.stopPropagation();
            onToggle();
        }}
        style={{
            display: 'inline-grid',
            placeItems: 'center',
            flexShrink: 0,
            width: size + 16,
            height: size + 16,
            padding: 0,
            border: floating ? 'none' : '1px solid var(--border-strong)',
            borderRadius: '50%',
            background: floating ? 'rgba(255, 255, 255, 0.92)' : 'var(--surface)',
            boxShadow: floating ? '0 2px 8px rgba(15, 23, 42, 0.25)' : 'none',
            cursor: 'pointer',
            transition: 'transform 0.15s',
        }}
        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.9)'; }}
        onMouseUp={(e) => { e.currentTarget.style.transform = ''; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <path
                d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.2 0 3.6 1.2 5.2 3 1.6-1.8 3-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"
                fill={saved ? '#e11d48' : 'none'}
                stroke={saved ? '#e11d48' : floating ? '#0f172a' : 'var(--text-muted)'}
                strokeWidth="2"
                strokeLinejoin="round"
            />
        </svg>
    </button>
);

export default HeartButton;
