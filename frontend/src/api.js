import { jwtDecode } from 'jwt-decode';

const TOKEN_KEY = 'token';

// Event App listens to in order to log the user out when the server responds with 401
export const AUTH_EXPIRED_EVENT = 'auth:expired';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const saveToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

// Session data from the JWT ({ id, email, role }), or null if there is no token or it has expired
export function decodeSession(token) {
    if (!token) return null;
    try {
        const { id, email, role, exp } = jwtDecode(token);
        if (exp && exp * 1000 <= Date.now()) return null;
        return { id, email, role };
    } catch {
        return null;
    }
}

export const VENUE_TYPES = {
    football_field: 'Football field',
    tennis_court: 'Tennis court',
    basketball_court: 'Basketball court',
};

export const venueTypeLabel = (type) => VENUE_TYPES[type] || type;

const SPORTS = { football_field: 'Football', tennis_court: 'Tennis', basketball_court: 'Basketball' };
export const sportLabel = (type) => SPORTS[type] || venueTypeLabel(type);

export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}

// fetch wrapper: JSON body, optional auth token, errors carry the server's message
export async function apiFetch(path, { method = 'GET', body, auth = false } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        if (res.status === 401 && auth) {
            window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
        }
        throw new ApiError(data?.message || `Error ${res.status}`, res.status);
    }
    return data;
}

// Icon for each venue type (the color is set in CSS per type)
export const VENUE_TYPE_ICONS = {
    football_field: '⚽',
    tennis_court: '🎾',
    basketball_court: '🏀',
};

// Venue amenities: keys match the backend (venue.model.js)
export const AMENITIES = {
    lighting: { label: 'Floodlights', icon: '💡' },
    changing_rooms: { label: 'Changing rooms', icon: '🚪' },
    showers: { label: 'Showers', icon: '🚿' },
    parking: { label: 'Parking', icon: '🅿️' },
    equipment_rental: { label: 'Equipment rental', icon: '🎒' },
    cafe: { label: 'Café', icon: '☕' },
    seating: { label: 'Spectator seating', icon: '🪑' },
    coaching: { label: 'Coach available', icon: '🧑‍🏫' },
};

export const SURFACE_SUGGESTIONS = ['Artificial turf', 'Natural grass', 'Hard court', 'Clay', 'Hardwood', 'Rubber'];
