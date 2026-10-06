// Local PostgreSQL without installation or admin rights (npm run db:local).
// Binaries come from the embedded-postgres package, data is stored in .pgdata/.
// Settings match DATABASE_URL in the services' .env.example files.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateToUtf8 } from './migrate-utf8.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, '.pgdata');
const DB_NAME = 'SportCourts';
const PORT = 5432;

const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: true,
    // UTF-8 regardless of the Windows system locale (which would otherwise give e.g. WIN1251)
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (msg) => console.error('[postgres]', String(msg).trim()),
});

// true if something already listens on the port (e.g. another Postgres instance)
function isPortBusy(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
    });
}

async function main() {
    if (await isPortBusy(PORT)) {
        console.error(`Port ${PORT} is already in use — PostgreSQL seems to be running already (maybe in another terminal).`);
        console.error('Close that process or stop the server with:');
        console.error('  node_modules\\@embedded-postgres\\windows-x64\\native\\bin\\pg_ctl.exe stop -D .pgdata');
        process.exit(1);
    }

    const firstRun = !fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'));
    if (firstRun) {
        console.log('Initializing cluster in .pgdata/ ...');
        await pg.initialise();
    }

    await pg.start();

    if (firstRun) {
        await pg.createDatabase(DB_NAME);
        console.log(`Database ${DB_NAME} created.`);
    }

    // Clusters created before the UTF-8 flags: move the database over, keeping all data
    await migrateToUtf8({ host: 'localhost', port: PORT, user: 'postgres', password: 'postgres' }, DB_NAME);

    // init.sql is idempotent, so applying it on every start also upgrades existing databases
    const client = pg.getPgClient(DB_NAME);
    await client.connect();
    await client.query(fs.readFileSync(path.join(ROOT, 'backend/db/init.sql'), 'utf8'));
    await client.end();
    console.log('Schema is up to date.');

    console.log(`PostgreSQL is running: postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`);
    console.log('Press Ctrl+C to stop.');
}

let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping PostgreSQL...');
    await pg.stop().catch(() => {});
    process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

main().catch(async (err) => {
    console.error('Failed to start PostgreSQL:', err ?? 'the process exited with an error (see [postgres] messages above)');
    await pg.stop().catch(() => {});
    process.exit(1);
});
