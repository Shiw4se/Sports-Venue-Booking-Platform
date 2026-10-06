import { format } from 'date-fns';

export const formatDay = (date) => format(new Date(date), 'EEEE, MMMM d');

export const formatDate = (date) => format(new Date(date), 'MMMM d, yyyy');

export const formatTimeRange = (start, end) =>
    `${format(new Date(start), 'HH:mm')}–${format(new Date(end), 'HH:mm')}`;

// Groups slots by day: [{ key, label, slots }], sorted by time
export function groupSlotsByDay(slots) {
    const groups = new Map();
    [...slots]
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
        .forEach(slot => {
            const key = format(new Date(slot.start_time), 'yyyy-MM-dd');
            if (!groups.has(key)) groups.set(key, { key, label: formatDay(slot.start_time), slots: [] });
            groups.get(key).slots.push(slot);
        });
    return [...groups.values()];
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const moneyCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

// Prices come from the API as decimal strings ("40.00")
export const formatMoney = (value) => money.format(Number(value) || 0);
const moneyWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Headline figures: $7,046 / $12.9K
export const formatMoneyCompact = (value) => (Number(value) >= 10000 ? moneyCompact : moneyWhole).format(Number(value) || 0);
