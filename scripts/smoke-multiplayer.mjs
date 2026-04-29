#!/usr/bin/env node
// Smoke test: two Socket.IO clients hand-shake through the v2 server,
// host creates room, guest joins, host starts, both submit choices, server
// emits room:effects to both — proving the iter-7 / S-324 fix is real.
//
// Drives the same wire protocol packages/client/src/socket.ts uses, so a
// pass here ⇒ two real browser tabs would handshake too.
//
// The server is launched as a child process (via tsx) so it can resolve
// the @xdyb/shared TypeScript source without a build step. The smoke
// itself runs from packages/server cwd so socket.io-client is in scope.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const serverDir = resolve(repoRoot, 'packages/server');

const requireFromCwd = createRequire(`${serverDir}/`);
const { io } = requireFromCwd('socket.io-client');

const PORT = String(3187 + Math.floor(Math.random() * 50));
const URL = `http://127.0.0.1:${PORT}`;

function log(msg) {
  process.stderr.write(`[smoke] ${msg}\n`);
}

function spawnServer() {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, PORT, CORS_ORIGIN: '*' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    const t = setTimeout(() => {
      if (!resolved) {
        rejectReady(new Error('server startup timeout'));
        try { child.kill('SIGKILL'); } catch {}
      }
    }, 8000);
    child.stdout.on('data', (buf) => {
      const s = buf.toString();
      process.stderr.write(`[server] ${s}`);
      if (s.includes('listening on') && !resolved) {
        resolved = true;
        clearTimeout(t);
        resolveReady(child);
      }
    });
    child.stderr.on('data', (buf) => {
      process.stderr.write(`[server-err] ${buf.toString()}`);
    });
    child.on('exit', (code) => {
      if (!resolved) rejectReady(new Error(`server exited early (code=${code})`));
    });
  });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 4000) {
  return new Promise((resolveWait, rejectWait) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      rejectWait(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (predicate(payload)) {
        clearTimeout(t);
        socket.off(event, handler);
        resolveWait(payload);
      }
    }
    socket.on(event, handler);
  });
}

async function main() {
  log(`starting server on :${PORT}`);
  const server = await spawnServer();

  const host = io(URL, { transports: ['websocket'] });
  const guest = io(URL, { transports: ['websocket'] });

  await Promise.all([
    new Promise((r) => host.on('connect', r)),
    new Promise((r) => guest.on('connect', r)),
  ]);
  log(`host=${host.id} guest=${guest.id} connected`);

  // Step 1: Host creates room
  host.emit('room:create', { nickname: '小明' });
  const created = await waitFor(host, 'room:created');
  log(`room created: ${created.code} players=${created.snapshot.players.length}`);
  if (!created.code || created.code.length !== 4) {
    throw new Error(`bad code: ${created.code}`);
  }

  // Step 2: Guest joins with the code; host should also see snapshot update
  const hostSawJoin = waitFor(host, 'room:snapshot', (s) => s.players.length === 2);
  guest.emit('room:join', { code: created.code, nickname: '小红' });
  const joined = await waitFor(guest, 'room:joined');
  log(`guest joined room ${joined.code} players=${joined.snapshot.players.length}`);
  if (joined.snapshot.players.length !== 2) {
    throw new Error(`guest sees ${joined.snapshot.players.length} players, want 2`);
  }
  const hsj = await hostSawJoin;
  log(`host sees ${hsj.players.length} players after join`);
  if (hsj.players.length !== 2) throw new Error('host did not see guest join');

  // Step 3: Host starts the game
  const guestPlayingSnap = waitFor(guest, 'room:snapshot', (s) => s.phase === 'PLAYING');
  host.emit('room:start');
  const playingSnap = await guestPlayingSnap;
  log(`game started; phase=${playingSnap.phase} round=${playingSnap.round}`);
  if (playingSnap.phase !== 'PLAYING') throw new Error('phase did not transition to PLAYING');

  // Step 4: Both submit choices — server resolves and emits effects to both
  const hostEffects = waitFor(host, 'room:effects');
  const guestEffects = waitFor(guest, 'room:effects');
  host.emit('room:choice', { choice: 'ROCK' });
  guest.emit('room:choice', { choice: 'PAPER' });

  const [he, ge] = await Promise.all([hostEffects, guestEffects]);
  log(`host got ${he.effects.length} effects (round=${he.round})`);
  log(`guest got ${ge.effects.length} effects (round=${ge.round})`);
  if (he.round !== ge.round) {
    throw new Error(`rounds out of sync: host=${he.round} guest=${ge.round}`);
  }
  if (JSON.stringify(he.effects) !== JSON.stringify(ge.effects)) {
    throw new Error(`effects not identical between host and guest`);
  }
  if (he.effects.length === 0) {
    throw new Error(`empty effects timeline`);
  }
  log(`✅ both clients received identical Effect[] timeline`);

  // Step 5: Verify host promotion / room cleanup on disconnect.
  // Guest leaves; host should see snapshot with 1 player still hosting.
  const hostAfterLeave = waitFor(host, 'room:snapshot', (s) => s.players.length === 1);
  guest.disconnect();
  const promo = await hostAfterLeave;
  log(`after guest disconnect: host sees ${promo.players.length} player; isHost=${promo.players[0].isHost}`);
  if (!promo.players[0].isHost) throw new Error('lone player not promoted to host');

  host.disconnect();
  await new Promise((r) => setTimeout(r, 100));
  server.kill('SIGTERM');
  log('✅ all multiplayer assertions passed');
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[smoke] ❌ FAIL: ${err.message}\n`);
  if (err.stack) process.stderr.write(err.stack + '\n');
  process.exit(1);
});
