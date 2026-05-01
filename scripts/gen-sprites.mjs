#!/usr/bin/env node
// gen-sprites.mjs — FINAL_GOAL §K6 art-asset hot-swap pipeline tooling.
//
// Emits the REFERENCE set of placeholder PNGs into assets/sprites/, one per
// (slot × role) combination, so:
//
//   • the user can SEE the asset slots (file listing under assets/sprites/
//     becomes self-documenting after a single `node scripts/gen-sprites.mjs`)
//   • the loadSpriteWithFallback pipeline gets exercised end-to-end on a
//     fresh clone (the PNG-present path is visibly verifiable: drop one in,
//     refresh the browser, see the override take over from the procedural
//     rig)
//   • the user has a known-good filename to overwrite with their own art
//     (no ambiguity about "where do I put p0-idle-0?")
//
// The placeholders are intentionally CRUDE — solid-color rectangles with the
// slot index drawn as a contrasting block, in a layout that's clearly meant
// to be replaced. The point is to validate the pipeline, not to ship art.
// The procedural rig is the production fallback; users replace these
// placeholders with their own hand-drawn / AI-generated PNGs.
//
// Implementation: zero-dependency PNG encoder (deflate + zlib chunks via
// Node's built-in `zlib`). No pixi, no canvas, no playwright — runs in
// ≤ 100 ms on a fresh clone.
//
// Usage:
//   node scripts/gen-sprites.mjs [--force]
//
// `--force` overwrites existing PNGs. Without it, files that already exist
// are left alone (so a user who has dropped real art doesn't have it
// clobbered by a stray run of this script).

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const ASSETS_ROOT = join(REPO_ROOT, 'assets', 'sprites');
const FORCE = process.argv.includes('--force');

// Deterministic per-slot palette so a glance at the output visibly maps
// "slot 0 = warm red" / "slot 1 = sky blue" etc. Matches the visual feel
// of the procedural Character rig (saturated indie-game colors).
const SLOT_COLORS = [
  { r: 0xc8, g: 0x4a, b: 0x4a }, // slot 0 — warm red
  { r: 0x4a, g: 0x90, b: 0xc8 }, // slot 1 — sky blue
  { r: 0x6a, g: 0xc8, b: 0x4a }, // slot 2 — leaf green
  { r: 0xc8, g: 0xa0, b: 0x4a }, // slot 3 — golden ochre
  { r: 0xa0, g: 0x4a, b: 0xc8 }, // slot 4 — purple
  { r: 0x4a, g: 0xc8, b: 0xb0 }, // slot 5 — teal
];

/** Encode raw RGBA pixel bytes as a PNG buffer. Conforms to RFC 2083:
 *  signature + IHDR + IDAT + IEND chunks. Color type 6 (RGBA, 8 bits per
 *  channel). Filtering disabled (filter byte 0 prepended to each scanline). */
function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error('rgba length mismatch');
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type RGBA
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  // Add filter byte (0 = None) at the start of each scanline.
  const stride = width * 4;
  const filtered = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    rgba.copy(filtered, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = deflateSync(filtered);

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Generate a placeholder character PNG. Bottom-center anchor convention:
 *  the body sits in the lower 80% of the canvas; the top 20% is the head.
 *  Slot color tints the body so the placeholder is visibly distinct per
 *  player. Adds a small "p<slot>" label block at the bottom-right corner
 *  so a user inspecting the file can verify the slot assignment without
 *  opening dev tools. */
function makeCharacterPng(slot) {
  const W = 96;
  const H = 128;
  const c = SLOT_COLORS[slot % SLOT_COLORS.length];
  const rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // Background: transparent so the placeholder reads as "obviously
      // not finished art" against the iso ground.
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }
  // head — circle in the top 32 px
  for (let y = 8; y < 40; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - W / 2;
      const dy = y - 24;
      if (dx * dx + dy * dy < 14 * 14) {
        const i = (y * W + x) * 4;
        rgba[i] = 0xf4;
        rgba[i + 1] = 0xc8;
        rgba[i + 2] = 0xa0;
        rgba[i + 3] = 0xff;
      }
    }
  }
  // body — slot-tinted rectangle
  for (let y = 40; y < 110; y++) {
    for (let x = W / 2 - 18; x < W / 2 + 18; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = c.r;
      rgba[i + 1] = c.g;
      rgba[i + 2] = c.b;
      rgba[i + 3] = 0xff;
    }
  }
  // legs
  for (let y = 110; y < 125; y++) {
    for (let x = W / 2 - 14; x < W / 2 - 2; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 0x2a;
      rgba[i + 1] = 0x1a;
      rgba[i + 2] = 0x10;
      rgba[i + 3] = 0xff;
    }
    for (let x = W / 2 + 2; x < W / 2 + 14; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 0x2a;
      rgba[i + 1] = 0x1a;
      rgba[i + 2] = 0x10;
      rgba[i + 3] = 0xff;
    }
  }
  // slot label dot — a 6×6 square in the upper-right corner, color
  // matching the body so a row of placeholders is visibly distinguishable
  for (let y = 4; y < 10; y++) {
    for (let x = W - 12; x < W - 6; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = c.r;
      rgba[i + 1] = c.g;
      rgba[i + 2] = c.b;
      rgba[i + 3] = 0xff;
    }
  }
  return encodePng(W, H, rgba);
}

/** Generate a placeholder house PNG. Bottom-center ground line; roof in
 *  the upper third tinted by slot color so the houses are also visibly
 *  distinct per player. */
function makeHousePng(slot) {
  const W = 192;
  const H = 168;
  const c = SLOT_COLORS[slot % SLOT_COLORS.length];
  const rgba = Buffer.alloc(W * H * 4);
  // walls — light beige
  for (let y = 60; y < H - 4; y++) {
    for (let x = 24; x < W - 24; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 0xe0;
      rgba[i + 1] = 0xd0;
      rgba[i + 2] = 0xb0;
      rgba[i + 3] = 0xff;
    }
  }
  // roof — slot-tinted triangle (drawn as horizontal strips)
  for (let y = 12; y < 60; y++) {
    const inset = Math.round((y - 12) * (W / 2 - 24) / 48);
    for (let x = W / 2 - inset; x < W / 2 + inset; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = c.r;
      rgba[i + 1] = c.g;
      rgba[i + 2] = c.b;
      rgba[i + 3] = 0xff;
    }
  }
  // door — dark brown
  for (let y = H - 60; y < H - 4; y++) {
    for (let x = W / 2 - 14; x < W / 2 + 14; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 0x4a;
      rgba[i + 1] = 0x2a;
      rgba[i + 2] = 0x18;
      rgba[i + 3] = 0xff;
    }
  }
  // ground line
  for (let y = H - 4; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      rgba[i] = 0x28;
      rgba[i + 1] = 0x18;
      rgba[i + 2] = 0x10;
      rgba[i + 3] = 0xff;
    }
  }
  return encodePng(W, H, rgba);
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function writeIfMissing(file, buf) {
  if (!FORCE && existsSync(file)) {
    console.log(`skip   ${file} (exists; pass --force to overwrite)`);
    return;
  }
  writeFileSync(file, buf);
  console.log(`wrote  ${file} (${buf.length} bytes)`);
}

function main() {
  const charsDir = join(ASSETS_ROOT, 'characters');
  const housesDir = join(ASSETS_ROOT, 'houses');
  ensureDir(charsDir);
  ensureDir(housesDir);

  for (let slot = 0; slot < 6; slot++) {
    writeIfMissing(
      join(charsDir, `p${slot}-idle-0.png`),
      makeCharacterPng(slot),
    );
    writeIfMissing(
      join(housesDir, `p${slot}-house.png`),
      makeHousePng(slot),
    );
  }
  console.log('done. drop your own PNGs over these to override the procedural rig.');
}

main();
