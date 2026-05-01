// loadSpriteWithFallback — FINAL_GOAL §K6 art-asset hot-swap pipeline.
//
// Contract:
//   loadSpriteWithFallback(name)
//     → resolves to a Pixi Texture if `/sprites/<name>.png` is reachable AND
//       loads as a valid image
//     → resolves to `null` if the asset is missing (404 / network error / not
//       a valid image)
//
// The caller (Character.ts / House.ts) treats `null` as "no override; keep
// the procedural rig". A non-null Texture is wrapped in a Sprite with the
// anchor convention documented in `assets/sprites/<role>/.gitkeep`:
//
//   • characters:  bottom-center anchor (0.5, 1.0) — feet on ground line
//   • houses:      bottom-center anchor (0.5, 1.0) — wall meets ground line
//
// The whole point is that a user can drop a PNG into `assets/sprites/…`,
// refresh the browser, and see their art replace the procedural sprite —
// with NO build step. Vite's publicDir is pointed at the repo-root `assets/`
// folder (see vite.config.ts) so a file at `assets/sprites/characters/p0-
// idle-0.png` is served at `/sprites/characters/p0-idle-0.png`.
//
// Implementation notes:
// - We HEAD-probe the URL first. If the response is non-2xx (404 most
//   commonly), we return null without invoking Pixi's Assets.load — this
//   avoids a noisy console error from Pixi when the file is absent.
// - On 2xx, we call Pixi's `Assets.load(url)` which returns a Texture.
//   Pixi caches by URL, so calling loadSpriteWithFallback for the same name
//   twice is cheap.
// - In environments without `fetch` (server-side import for tests), the
//   probe degrades to checking the injected `fetcher` argument. The unit
//   test injects mocks for both branches.
//
// API is deliberately small — one function, one Promise. State lives in
// Pixi's Assets cache, NOT in this module.

import type { Texture } from 'pixi.js';

/** Probe + load result. */
export type SpriteOverride = Texture | null;

/** Optional fetch + texture-loader injection points so the unit test can
 *  exercise both branches (PNG present / absent) without spinning up a real
 *  HTTP server or a real PixiJS Application. Production code calls with
 *  no arguments and the global `fetch` + Pixi's `Assets.load` are used. */
export interface LoadSpriteDeps {
  /** Probe the URL with HEAD (or GET fallback). Should return `true` iff
   *  the resource exists and responds with 2xx. */
  probe?: (url: string) => Promise<boolean>;
  /** Load the texture by URL. Should reject (or return null) if the bytes
   *  are not a valid image. */
  load?: (url: string) => Promise<Texture | null>;
}

/** Default URL prefix. Matches Vite's `publicDir = '../../assets'` so a
 *  PNG at `assets/sprites/characters/p0-idle-0.png` is reachable at
 *  `/sprites/characters/p0-idle-0.png`. Exposed for tests + for tooling
 *  (gen-sprites.mjs uses the same prefix when it dumps reference PNGs). */
export const SPRITE_URL_PREFIX = '/sprites/';

/** Compose the served URL for a given logical sprite name. The name is the
 *  path under `assets/sprites/`, with or without `.png` extension. */
export function spriteUrl(name: string): string {
  const trimmed = name.startsWith('/') ? name.slice(1) : name;
  const withExt = trimmed.endsWith('.png') ? trimmed : `${trimmed}.png`;
  return `${SPRITE_URL_PREFIX}${withExt}`;
}

/** Default HEAD probe using the global `fetch`. Returns false on any
 *  non-2xx OR network error — never throws. The point is to silently fall
 *  back to procedural sprites when the user hasn't supplied art. */
async function defaultProbe(url: string): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    // Many static-file servers (including Vite dev) handle HEAD correctly,
    // but if HEAD is unsupported, we fall back to a ranged GET that only
    // pulls 1 byte. Either way, a 404 produces a clean `false`.
    const head = await fetch(url, { method: 'HEAD' });
    if (head.ok) return true;
    if (head.status === 405) {
      const get = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      return get.ok || get.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

/** Default texture loader using Pixi's Assets API. We import lazily so the
 *  module can be imported under jsdom (tests) without bringing the full
 *  Pixi runtime + WebGL stubs along. */
async function defaultLoad(url: string): Promise<Texture | null> {
  try {
    const { Assets } = await import('pixi.js');
    const tex = (await Assets.load(url)) as Texture | undefined;
    return tex ?? null;
  } catch {
    return null;
  }
}

/** Load `<name>.png` from the served `/sprites/` namespace. Returns the
 *  Texture on success, or `null` if absent / invalid. Never throws. */
export async function loadSpriteWithFallback(
  name: string,
  deps: LoadSpriteDeps = {},
): Promise<SpriteOverride> {
  const url = spriteUrl(name);
  const probe = deps.probe ?? defaultProbe;
  const load = deps.load ?? defaultLoad;
  const exists = await probe(url);
  if (!exists) return null;
  return load(url);
}
