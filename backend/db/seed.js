// Demo data: accounts, venues, a week of slots and some bookings.
//   npm run seed            — fills an empty database
//   npm run seed -- --add-reviews — only adds demo reviews to an existing demo database
//   npm run seed -- --reset — wipes all data first (refuses if real accounts exist,
//                             add --include-real-users to delete them as well)
// Uses DATABASE_URL from backend/user-service/.env and that service's pg/bcrypt packages.
const path = require('path');
const { createRequire } = require('module');

const userServiceRequire = createRequire(path.join(__dirname, '../user-service/package.json'));
userServiceRequire('dotenv').config({ path: path.join(__dirname, '../user-service/.env') });
const { Client } = userServiceRequire('pg');
const bcrypt = userServiceRequire('bcrypt');

const RESET = process.argv.includes('--reset');
// Adds demo reviews to an already seeded database without touching anything else
const ADD_REVIEWS_ONLY = process.argv.includes('--add-reviews');
// --reset refuses to delete real (non-demo) accounts unless this flag is given too
const DELETE_REAL_USERS = process.argv.includes('--include-real-users');

const USERS = [
    { name: 'Admin', email: 'admin@sportbook.dev', password: 'admin1234', role: 'admin' },
    { name: 'Demo User', email: 'demo@sportbook.dev', password: 'demo1234', role: 'user', avatar_color: '#7c3aed' },
    { name: 'Alex Morgan', email: 'alex@sportbook.dev', password: 'demo1234', role: 'user' },
    { name: 'Sam Lee', email: 'sam@sportbook.dev', password: 'demo1234', role: 'user' },
    { name: 'Chris Diaz', email: 'chris@sportbook.dev', password: 'demo1234', role: 'user' },
];

const VENUES = [
    { name: 'Riverside Arena', location: '12 Embankment Rd', type: 'football_field', price: 60,
      surface: 'Artificial turf', indoor: false, capacity: 22,
      amenities: ['lighting', 'changing_rooms', 'showers', 'parking', 'seating'],
      description: 'Full-size 11-a-side pitch with FIFA-quality artificial turf and floodlights for evening games. Changing rooms with hot showers and free parking right next to the entrance.' },
    { name: 'City Five-a-Side', location: '48 Market St', type: 'football_field', price: 35,
      surface: 'Artificial turf', indoor: true, capacity: 10,
      amenities: ['lighting', 'changing_rooms', 'showers', 'equipment_rental', 'cafe'],
      description: 'Indoor 5-a-side pitch in the city centre, open all year round whatever the weather. Bibs and balls are free, and the café upstairs overlooks the pitch.' },
    { name: 'Ace Tennis Club', location: '3 Victory Ave', type: 'tennis_court', price: 25,
      surface: 'Hard court', indoor: false, capacity: 4,
      amenities: ['lighting', 'changing_rooms', 'equipment_rental', 'parking'],
      description: 'Fast acrylic hard court suitable for singles and doubles. Rackets and balls are available to rent at reception.' },
    { name: 'Green Clay Courts', location: '77 Park Lane', type: 'tennis_court', price: 30,
      surface: 'Clay', indoor: false, capacity: 4,
      amenities: ['changing_rooms', 'showers', 'coaching', 'cafe'],
      description: 'Two well-kept red clay courts in a quiet park. A coach is available on request for private lessons and match practice.' },
    { name: 'Street Ball Arena', location: '5 Harbour Walk', type: 'basketball_court', price: 20,
      surface: 'Rubber', indoor: false, capacity: 10,
      amenities: ['lighting', 'seating'],
      description: 'Outdoor court by the river with a shock-absorbing rubber surface and night lighting. A favourite spot for evening pick-up games.' },
    { name: 'Downtown Hoops', location: '21 Central Sq', type: 'basketball_court', price: 28,
      surface: 'Hardwood', indoor: true, capacity: 10,
      amenities: ['lighting', 'changing_rooms', 'showers', 'seating', 'equipment_rental', 'parking'],
      description: 'Indoor maple hardwood court with tiered seating for spectators. Great for league games, team training and tournaments.' },
];

const HISTORY_DAYS = 84;

// Start hours and durations of the daily slots
const DAILY_SLOTS = [[8, 1], [10, 1.5], [12, 1], [16, 1.5], [18, 1.5], [20, 1]];

// Deterministic pseudo-random numbers so every seed looks the same
let seed = 42;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// Columns are timestamptz; an ISO string with "Z" is unambiguous whatever the server time zone
const toDb = (date) => date.toISOString();

const REVIEW_TEXTS = {
    5: ['Perfect surface and great lighting, will book again!', 'Best place in town, everything was spotless.',
        'Loved it — friendly staff and easy to find.', 'Excellent condition, the changing rooms were clean.'],
    4: ['Very good overall, parking was a bit tight.', 'Nice venue, a little busy in the evening.',
        'Good value for money.', 'Solid surface, would come back.'],
    3: ['Okay for a casual game.', 'Decent, but the lights could be brighter.', 'Fine, nothing special.'],
    2: ['Surface needs some maintenance.', 'Changing rooms were not very clean.'],
    1: ['Booked slot started late, disappointing.'],
};
const RATING_WEIGHTS = [[5, 0.45], [4, 0.33], [3, 0.14], [2, 0.06], [1, 0.02]];

function pickRating() {
    let r = random();
    for (const [rating, weight] of RATING_WEIGHTS) {
        if ((r -= weight) <= 0) return rating;
    }
    return 5;
}

// Reviews for ~45% of played demo bookings, then the venues' rating aggregates
async function seedReviews(db) {
    const { rows: played } = await db.query(
        `SELECT b.id, b.user_id, b.venue_id, b.end_time FROM bookings b
         JOIN users u ON u.id = b.user_id
         LEFT JOIN reviews r ON r.booking_id = b.id
         WHERE b.status = 'booked' AND b.end_time < now() AND r.id IS NULL AND u.email = ANY($1)
         ORDER BY b.start_time`,
        [USERS.map(u => u.email)]
    );
    let added = 0;
    for (const b of played) {
        if (random() > 0.45) continue;
        const rating = pickRating();
        const texts = REVIEW_TEXTS[rating];
        const comment = random() < 0.75 ? texts[Math.floor(random() * texts.length)] : null;
        const createdAt = new Date(new Date(b.end_time).getTime() + (1 + random() * 20) * 3600000);
        await db.query(
            'INSERT INTO reviews (booking_id, user_id, venue_id, rating, comment, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
            [b.id, b.user_id, b.venue_id, rating, comment, createdAt.toISOString()]
        );
        added++;
    }
    await db.query(`UPDATE venues v SET rating_avg = s.avg, rating_count = s.cnt
        FROM (SELECT venue_id, round(avg(rating), 2) AS avg, count(*)::int AS cnt FROM reviews GROUP BY venue_id) s
        WHERE s.venue_id = v.id`);
    return added;
}

async function main() {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();

    try {
        const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM venues');
        if (ADD_REVIEWS_ONLY) {
            const added = await seedReviews(db);
            console.log(`Added ${added} demo reviews; venue ratings updated.`);
            return;
        }

        if (count > 0 && !RESET) {
            console.log(`The database already has ${count} venues. Run "npm run seed -- --reset" to wipe it and reseed.`);
            return;
        }

        if (RESET && !DELETE_REAL_USERS) {
            const { rows: realUsers } = await db.query(
                'SELECT email FROM users WHERE NOT (email = ANY($1))',
                [USERS.map(u => u.email)]
            );
            if (realUsers.length > 0) {
                console.error(`Refusing to reset: the database has ${realUsers.length} non-demo account(s):`);
                realUsers.slice(0, 10).forEach(u => console.error(`  ${u.email}`));
                console.error('Their accounts and bookings would be deleted. If that is intended, run:');
                console.error('  npm run seed -- --reset --include-real-users');
                process.exitCode = 1;
                return;
            }
        }

        await db.query('BEGIN');
        if (RESET) {
            await db.query('TRUNCATE bookings, available_slots, venues, users CASCADE');
            console.log('Existing data wiped.');
        }

        // Demo accounts look like they signed up half a year ago
        const memberSince = new Date(Date.now() - 180 * 86400000);
        const userIds = [];
        for (const u of USERS) {
            const hash = await bcrypt.hash(u.password, 10);
            const { rows } = await db.query(
                'INSERT INTO users (name, email, password, role, avatar_color, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [u.name, u.email, hash, u.role, u.avatar_color || null, toDb(memberSince)]
            );
            userIds.push(rows[0].id);
        }
        const otherPlayers = userIds.slice(2); // everyone except the admin and the demo user
        const demoUserId = userIds[1];

        const now = new Date();
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);

        let slotCount = 0;
        let bookingCount = 0;

        for (const v of VENUES) {
            const { rows: [venue] } = await db.query(
                `INSERT INTO venues (name, location, type, description, price_per_hour, surface, indoor, capacity, amenities)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
                [v.name, v.location, v.type, v.description, v.price, v.surface, v.indoor, v.capacity, v.amenities]
            );

            // 12 weeks of history (profile activity heatmap, achievements) + 7 days ahead
            for (let day = -HISTORY_DAYS; day < 7; day++) {
                for (const [hour, duration] of DAILY_SLOTS) {
                    const start = new Date(today);
                    start.setDate(start.getDate() + day);
                    start.setHours(hour, 0, 0, 0);
                    const end = new Date(start.getTime() + duration * 3600000);
                    const isPast = start <= now;

                    // Past slots only exist if someone booked them; older history is sparser
                    const pastChance = day >= -5 ? 0.5 : 0.12;
                    const bookIt = isPast ? random() < pastChance : random() < 0.35;
                    if (isPast && !bookIt) continue;

                    const { rows: [slot] } = await db.query(
                        'INSERT INTO available_slots (venue_id, start_time, end_time, is_available) VALUES ($1, $2, $3, $4) RETURNING id',
                        [venue.id, toDb(start), toDb(end), !bookIt]
                    );
                    slotCount++;

                    if (bookIt) {
                        // The demo user gets a fair share so their profile is not empty
                        // The demo user plays ~3 times a week, so some achievements are still in progress
                        const demoShare = !isPast ? 0.22 : day >= -5 ? 0.12 : 0.06;
                        const userId = random() < demoShare ? demoUserId : otherPlayers[Math.floor(random() * otherPlayers.length)];
                        const cancelled = !isPast && random() < 0.08;
                        await db.query(
                            `INSERT INTO bookings (user_id, venue_id, slot_id, start_time, end_time, price, status)
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [userId, venue.id, slot.id, toDb(start), toDb(end), v.price * duration, cancelled ? 'cancelled' : 'booked']
                        );
                        if (cancelled) {
                            await db.query('UPDATE available_slots SET is_available = true WHERE id = $1', [slot.id]);
                        }
                        bookingCount++;
                    }
                }
            }
        }

        const reviewCount = await seedReviews(db);
        await db.query('COMMIT');
        console.log(`Seeded ${USERS.length} users, ${VENUES.length} venues, ${slotCount} slots, ${bookingCount} bookings, ${reviewCount} reviews.`);
        console.log('Demo accounts:');
        for (const u of USERS.slice(0, 2)) console.log(`  ${u.role.padEnd(5)}  ${u.email} / ${u.password}`);
    } catch (err) {
        await db.query('ROLLBACK').catch(() => {});
        throw err;
    } finally {
        await db.end();
    }
}

main().catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
});
