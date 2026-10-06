import React, { useEffect, useState } from 'react';

// Dark enough shades for white initials to stay readable
export const AVATAR_COLORS = [
    '#0f766e', '#15803d', '#0e7490', '#2563eb', '#4f46e5',
    '#7c3aed', '#c026d3', '#db2777', '#dc2626', '#c2410c', '#a16207', '#475569',
];

const initials = (name, email) => {
    const source = (name || '').trim() || email || '?';
    const parts = source.split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : source[0]).toUpperCase();
};

// Uploaded photo if there is one (src), otherwise colored initials
const Avatar = ({ name, email, color, src, size = 32, className = '' }) => {
    const [broken, setBroken] = useState(false);
    useEffect(() => setBroken(false), [src]);

    const base = {
        display: 'inline-grid',
        placeItems: 'center',
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
    };

    if (src && !broken) {
        return (
            <span className={className} style={base}>
                <img
                    src={src}
                    alt=""
                    width={size}
                    height={size}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setBroken(true)}
                />
            </span>
        );
    }

    return (
        <span
            className={className}
            aria-hidden="true"
            style={{
                ...base,
                background: color || 'linear-gradient(135deg, var(--primary), #22c55e)',
                color: '#fff',
                fontSize: Math.round(size * 0.4),
                fontWeight: 700,
                letterSpacing: '0.02em',
            }}
        >
            {initials(name, email)}
        </span>
    );
};

export default Avatar;
