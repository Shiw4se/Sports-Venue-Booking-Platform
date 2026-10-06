// Local RabbitMQ without installation or admin rights (npm run mq:local, Windows only).
// On first run downloads portable Erlang/OTP and RabbitMQ (zip) into %USERPROFILE%\devtools.
// Broker: amqp://localhost:5672, management UI: http://localhost:15672 (guest / guest).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ERLANG_VERSION = '28.5.0.7';
const RABBITMQ_VERSION = '4.3.6';

const TOOLS_DIR = process.env.DEVTOOLS_DIR || path.join(process.env.USERPROFILE || '.', 'devtools');
const ERLANG_HOME = path.join(TOOLS_DIR, 'erlang');
const RABBITMQ_HOME = path.join(TOOLS_DIR, `rabbitmq_server-${RABBITMQ_VERSION}`);
const RABBITMQ_BASE = path.join(TOOLS_DIR, 'rabbitmq-data');
const SBIN = path.join(RABBITMQ_HOME, 'sbin');
const PORT = 5672;

const DOWNLOADS = [
    {
        name: `Erlang/OTP ${ERLANG_VERSION}`,
        url: `https://github.com/erlang/otp/releases/download/OTP-${ERLANG_VERSION}/otp_win64_${ERLANG_VERSION}.zip`,
        check: path.join(ERLANG_HOME, 'bin', 'erl.exe'),
        extractTo: ERLANG_HOME,
    },
    {
        name: `RabbitMQ ${RABBITMQ_VERSION}`,
        url: `https://github.com/rabbitmq/rabbitmq-server/releases/download/v${RABBITMQ_VERSION}/rabbitmq-server-windows-${RABBITMQ_VERSION}.zip`,
        check: path.join(SBIN, 'rabbitmq-server.bat'),
        extractTo: TOOLS_DIR, // the archive already contains the rabbitmq_server-<version> folder
    },
];

function isPortBusy(port) {
    return new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
    });
}

async function ensureInstalled() {
    for (const item of DOWNLOADS) {
        if (fs.existsSync(item.check)) continue;

        fs.mkdirSync(item.extractTo, { recursive: true });
        const zipPath = path.join(TOOLS_DIR, path.basename(item.url));
        console.log(`Downloading ${item.name}...`);
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`Failed to download ${item.url}: HTTP ${res.status}`);
        await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipPath));

        console.log(`Extracting ${item.name}...`);
        // tar.exe ships with Windows 10+ and can extract zip files
        const tar = spawnSync('tar', ['-xf', zipPath, '-C', item.extractTo], { stdio: 'inherit' });
        if (tar.status !== 0) throw new Error(`Failed to extract ${zipPath}`);
        fs.rmSync(zipPath, { force: true });
    }
}

function rabbitEnv() {
    fs.mkdirSync(RABBITMQ_BASE, { recursive: true });
    const pluginsFile = path.join(RABBITMQ_BASE, 'enabled_plugins');
    if (!fs.existsSync(pluginsFile)) fs.writeFileSync(pluginsFile, '[rabbitmq_management].\n');

    return {
        ...process.env,
        ERLANG_HOME,
        RABBITMQ_BASE,
        RABBITMQ_ENABLED_PLUGINS_FILE: pluginsFile,
    };
}

async function main() {
    if (process.platform !== 'win32') {
        console.error('This script is for Windows. On Linux/macOS use docker compose or a package manager.');
        process.exit(1);
    }
    if (await isPortBusy(PORT)) {
        console.error(`Port ${PORT} is already in use — RabbitMQ seems to be running already.`);
        console.error(`To stop it: "${path.join(SBIN, 'rabbitmqctl.bat')}" stop`);
        process.exit(1);
    }

    await ensureInstalled();

    const env = rabbitEnv();
    console.log('Starting RabbitMQ (first start may take up to a minute)...');
    console.log('Broker: amqp://localhost:5672, management UI: http://localhost:15672 (guest / guest). Press Ctrl+C to stop.');

    const server = spawn('cmd.exe', ['/c', path.join(SBIN, 'rabbitmq-server.bat')], { cwd: SBIN, env, stdio: 'inherit' });
    server.on('exit', (code) => process.exit(code ?? 0));

    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        console.log('\nStopping RabbitMQ...');
        spawnSync('cmd.exe', ['/c', path.join(SBIN, 'rabbitmqctl.bat'), 'stop'], { cwd: SBIN, env, stdio: 'ignore' });
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch((err) => {
    console.error('Failed to start RabbitMQ:', err.message || err);
    process.exit(1);
});
