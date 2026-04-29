#!/usr/bin/env node
// scripts/smoke-headless.mjs — fast headless CI smoke for xiaodaoyiba-v2.
//
// Boots the @xdyb/server (random port), pings /healthz, then runs the
// canonical sim and asserts a clean exit code. Designed to be the single
// invocation a CI gate needs to run after `pnpm install` to assert that:
//
//   1. The Socket.IO server starts on demand (no port hardcoding).
//   2. /healthz answers with shared-package version + room count.
//   3. The deterministic sim (seed=42, 50 rounds, 4 players, canonical
//      bots) stays inside §A2 budgets and exits 0 under --strict.
//
// Usage:
//   node scripts/smoke-headless.mjs
//   SMOKE_PORT=0 node scripts/smoke-headless.mjs   (default — random port)
//
// Exits non-zero on any failure with a clear stderr breadcrumb so the CI
// log surfaces the failing stage immediately.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const log = (msg) => process.stderr.write(`[smoke] ${msg}\n`);
const fail = (msg, code = 1) => {
  process.stderr.write(`[smoke] FAIL: ${msg}\n`);
  process.exit(code);
};

/**
 * Spawn a child process and resolve when stdout/stderr matches `readyPattern`,
 * or reject on early exit / timeout.
 */
function spawnUntilReady(cmd, args, opts, readyPattern, timeoutMs) {
  return new Promise((resolveReady, rejectReady) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    let buffer = '';

    const onChunk = (chunk) => {
      buffer += chunk.toString();
      // Mirror to our stderr so the user sees server logs.
      process.stderr.write(chunk);
      if (!ready && readyPattern.test(buffer)) {
        ready = true;
        const m = buffer.match(/listening on :(\d+)/);
        const port = m ? Number(m[1]) : null;
        resolveReady({ child, port });
      }
    };

    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.once('exit', (exitCode) => {
      if (!ready) rejectReady(new Error(`child exited ${exitCode} before ready`));
    });

    const t = setTimeout(() => {
      if (!ready) {
        child.kill('SIGTERM');
        rejectReady(new Error(`timeout (${timeoutMs}ms) waiting for ${readyPattern}`));
      }
    }, timeoutMs);
    t.unref();
  });
}

/** Stop a child process and wait for it to exit (max 3s). */
function stop(child) {
  return new Promise((resolveStop) => {
    if (!child || child.exitCode !== null) return resolveStop();
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      resolveStop();
    }, 3000);
    t.unref();
    child.once('exit', () => {
      clearTimeout(t);
      resolveStop();
    });
    child.kill('SIGTERM');
  });
}

async function pingHealthz(port) {
  const url = `http://127.0.0.1:${port}/healthz`;
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`/healthz status=${res.status}`);
  const body = await res.json();
  if (body.ok !== true) throw new Error(`/healthz ok=${body.ok}`);
  if (typeof body.shared !== 'string') throw new Error(`/healthz missing 'shared'`);
  if (typeof body.rooms !== 'number') throw new Error(`/healthz missing 'rooms'`);
  log(`/healthz ok shared=${body.shared} rooms=${body.rooms}`);
}

async function runSimStrict() {
  return new Promise((resolveRun) => {
    const child = spawn(
      'pnpm',
      [
        '--silent',
        '--filter',
        '@xdyb/server',
        'sim',
        '--players',
        '4',
        '--bots',
        'counter,random,iron,mirror',
        '--rounds',
        '50',
        '--seed',
        '42',
        '--strict',
      ],
      { cwd: repoRoot, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    child.once('exit', (exitCode) => resolveRun(exitCode ?? 1));
  });
}

async function main() {
  const port = Number(process.env.SMOKE_PORT ?? 0);
  log(`booting @xdyb/server on port ${port === 0 ? '<random>' : port}`);

  let serverChild;
  try {
    // Run the server directly via tsx (not `pnpm dev`, which uses `tsx watch`
    // — that can leave a watcher orphaned after SIGTERM in CI).
    const serverPkg = resolve(repoRoot, 'packages/server');
    const { child, port: assignedPort } = await spawnUntilReady(
      'pnpm',
      ['--silent', 'exec', 'tsx', 'src/index.ts'],
      { cwd: serverPkg, env: { ...process.env, PORT: String(port) } },
      /listening on :\d+/,
      15_000,
    );
    serverChild = child;
    if (!assignedPort) fail('could not parse listening port from server logs');
    log(`server up on :${assignedPort}`);

    // Tiny grace period so Socket.IO finishes wiring before we hit /healthz.
    await wait(50);
    await pingHealthz(assignedPort);
  } catch (err) {
    if (serverChild) await stop(serverChild);
    fail(`server boot/healthz: ${err instanceof Error ? err.message : String(err)}`);
  }

  log('running canonical sim (seed=42, 50 rounds, 4 players, --strict)');
  const simExit = await runSimStrict();
  await stop(serverChild);

  if (simExit !== 0) fail(`sim exit=${simExit} (expected 0 — §A2 budget breach)`);
  log('OK — server boots, /healthz answers, sim exits 0 under --strict');
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
