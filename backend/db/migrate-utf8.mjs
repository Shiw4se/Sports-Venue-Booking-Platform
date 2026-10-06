// Moves the SportCourts database to UTF-8 encoding without losing data.
//
// Older `npm run db:local` clusters on Windows were initialised with the system locale
// (e.g. WIN1251), which cannot store characters like "é" or emoji. This script:
//   1. creates SportCourts_utf8 (UTF-8, C locale) and applies init.sql to it,
//   2. copies every row of users, venues, available_slots and bookings,
//   3. checks that the row counts match,
//   4. renames the old database to SportCourts_<encoding>_backup and the new one to SportCourts.
// Other connections to the old database are closed during the swap (services reconnect).
//
// Runs automatically from db:local; can also be run by hand: node backend/db/migrate-utf8.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TABLES = ['users', 'venues', 'available_slots', 'bookings']; // foreign-key order
const BATCH = 200;

const connect = async (base, database) => {
    const client = new pg.Client({ ...base, database });
    await client.connect();
    return client;
};

export async function databaseEncoding(base, dbName) {
    const admin = await connect(base, 'postgres');
    try {
        const { rows } = await admin.query(
            'SELECT pg_encoding_to_char(encoding) AS encoding FROM pg_database WHERE datname = $1', [dbName]);
        return rows[0]?.encoding ?? null;
    } finally {
        await admin.end();
    }
}

async function copyTable(source, target, table) {
    const { rows } = await source.query(`SELECT * FROM public.${table}`);
    if (rows.length === 0) return 0;
    const columns = Object.keys(rows[0]);
    const columnList = columns.map(c => `"${c}"`).join(', ');

    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const params = [];
        const tuples = chunk.map(row => `(${columns.map(c => {
            params.push(row[c]);
            return `$${params.length}`;
        }).join(', ')})`);
        await target.query(`INSERT INTO public.${table} (${columnList}) VALUES ${tuples.join(', ')}`, params);
    }
    return rows.length;
}

export async function migrateToUtf8(base, dbName, log = console.log) {
    const encoding = await databaseEncoding(base, dbName);
    if (!encoding || encoding === 'UTF8') return false;

    const tempName = `${dbName}_utf8`;
    const backupName = `${dbName}_${encoding.toLowerCase()}_backup`;
    log(`Database ${dbName} uses ${encoding}; migrating it to UTF-8...`);

    const admin = await connect(base, 'postgres');
    try {
        await admin.query(`DROP DATABASE IF EXISTS "${tempName}"`);
        await admin.query(`CREATE DATABASE "${tempName}" WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);

        const source = await connect(base, dbName);
        const target = await connect(base, tempName);
        try {
            await target.query(fs.readFileSync(path.join(ROOT, 'backend/db/init.sql'), 'utf8'));
            await target.query('BEGIN');
            for (const table of TABLES) {
                const copied = await copyTable(source, target, table);
                const { rows: [{ n }] } = await source.query(`SELECT count(*)::int AS n FROM public.${table}`);
                if (copied !== n) throw new Error(`${table}: copied ${copied} of ${n} rows`);
                log(`  ${table}: ${copied} rows`);
            }
            await target.query('COMMIT');
        } catch (err) {
            await target.query('ROLLBACK').catch(() => {});
            throw err;
        } finally {
            await source.end();
            await target.end();
        }

        // Swap: close other sessions on the old database, then rename both
        await admin.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [dbName]);
        await admin.query(`DROP DATABASE IF EXISTS "${backupName}"`);
        await admin.query(`ALTER DATABASE "${dbName}" RENAME TO "${backupName}"`);
        await admin.query(`ALTER DATABASE "${tempName}" RENAME TO "${dbName}"`);
        log(`Done. The old database is kept as ${backupName}.`);
        return true;
    } catch (err) {
        await admin.query(`DROP DATABASE IF EXISTS "${tempName}"`).catch(() => {});
        throw err;
    } finally {
        await admin.end();
    }
}

// Run directly: migrate the running local server
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const base = { host: 'localhost', port: 5432, user: 'postgres', password: 'postgres' };
    migrateToUtf8(base, 'SportCourts')
        .then(changed => { if (!changed) console.log('SportCourts already uses UTF-8, nothing to do.'); })
        .catch(err => {
            console.error('Migration failed, nothing was changed:', err.message);
            process.exit(1);
        });
}
