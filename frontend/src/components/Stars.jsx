import React, { useState } from 'react';

const STAR = 'M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z';
const FILL = '#f59e0b';

// Read-only rating; partial stars are drawn with a clipped overlay (4.5 → four and a half)
export const Stars = ({ value = 0, size = 16, label }) => (
    <span role="img" aria-label={label || `${Number(value).toFixed(1)} out of 5 stars`} style={{ display: 'inline-flex', gap: 1 }}>
        {[0, 1, 2, 3, 4].map(i => {
            const fill = Math.max(0, Math.min(1, value - i));
            return (
                <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
                    <path d={STAR} fill="var(--border-strong)" />
                    {fill > 0 && (
                        <>
                            <clipPath id={`star-${i}-${size}-${Math.round(fill * 100)}`}>
                                <rect width={20 * fill} height="20" />
                            </clipPath>
                            <path d={STAR} fill={FILL} clipPath={`url(#star-${i}-${size}-${Math.round(fill * 100)})`} />
                        </>
                    )}
                </svg>
            );
        })}
    </span>
);

const LABELS = ['Terrible', 'Poor', 'Okay', 'Good', 'Excellent'];

// Interactive 1–5 picker (radio group, keyboard accessible)
export const StarInput = ({ value, onChange, size = 32 }) => {
    const [hover, setHover] = useState(0);
    const shown = hover || value;
    return (
        <div>
            <div role="radiogroup" aria-label="Rating" style={{ display: 'inline-flex', gap: 4 }} onMouseLeave={() => setHover(0)}>
                {[1, 2, 3, 4, 5].map(n => (
                    <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={value === n}
                        aria-label={`${n} star${n > 1 ? 's' : ''} — ${LABELS[n - 1]}`}
                        onClick={() => onChange(n)}
                        onMouseEnter={() => setHover(n)}
                        style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', lineHeight: 0 }}
                    >
                        <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
                            <path d={STAR} fill={n <= shown ? FILL : 'var(--border-strong)'} />
                        </svg>
                    </button>
                ))}
            </div>
            <div style={{ minHeight: 20, marginTop: 4, color: 'var(--text-muted)', fontSize: 13, fontWeight: 600 }}>
                {shown ? LABELS[shown - 1] : 'Tap a star to rate'}
            </div>
        </div>
    );
};
