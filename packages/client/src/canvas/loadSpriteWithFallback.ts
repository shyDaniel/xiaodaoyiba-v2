// loadSpriteWithFallback — FINAL_GOAL §K6 art-asset hot-swap pipeline.
//
// Contract:
//   loadSpriteWithFallback(name)
//     → resolves to a Pixi Texture if `/sprites/<name>.png` is reachable AND
//       loads as a valid image
//     → resolves to `null` if the asset is missing (404 / network error / not
//       a valid PNG)
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
// === Why a HEAD probe is not sufficient (§S-516 root cause) ===
//
// Vite's dev server applies an SPA history fallback: any GET that is not
// for a known static asset returns `index.html` with status 200. That means
// a HEAD on `/sprites/foo.png` for a NON-EXISTENT file ALSO returns 200,
// because Vite happily falls through to the SPA index. The §K6 contract
// "404 → null without invoking Pixi" is therefore unreachable in dev under
// a naive HEAD probe — the loader thinks every sprite name exists and
// always defers to Pixi's Assets.load, which then receives HTML bytes,
// fails to decode, and silently returns null only because we swallow the
// decode error in defaultLoad's catch.
//
// To make the contract real, defaultProbe issues a TINY ranged GET (the
// first 8 bytes) and checks two signals:
//
//   1. The Content-Type header MUST start with `image/`. HTML SPA fallback
//      sends `text/html`, which we reject.
//   2. The first 8 bytes MUST be the PNG magic signature
//      (89 50 4E 47 0D 0A 1A 0A). This catches servers that strip /
//      misreport content-type but still SPA-fallback the body.
//
// Either signal failing → probe returns false → loader returns null and
// Pixi.Assets.load is NEVER invoked for the missing path. This eliminates
// the spurious GETs and silent decode-failures observed in the live
// network log this iteration.
//
// In addition, vite.config.ts now installs a dev-server middleware that
// returns a real 404 for any unresolved `/sprites/*` path BEFORE the SPA
// fallback fires, so even the ranged GET sees a clean 404. Both layers
// matter: the middleware fixes dev, the magic-byte check fixes any
// production / preview / static-host setup that happens to misbehave.
//
// API is deliberately small — one function, one Promise. State lives in
// Pixi's Assets cache, NOT in this module.

import { Assets, type Texture } from 'pixi.js';

/** Probe + load result. */
export type SpriteOverride = Texture | null;

/** Optional fetch + texture-loader injection points so the unit test can
 *  exercise both branches (PNG present / absent) without spinning up a real
 *  HTTP server or a real PixiJS Application. Production code calls with
 *  no arguments and the global `fetch` + Pixi's `Assets.load` are used. */
export interface LoadSpriteDeps {
  /** Probe the URL. Should return `true` iff the resource exists, responds
   *  with 2xx, AND looks like a real image (Content-Type image/* OR PNG
   *  magic bytes). HTML SPA-fallback responses MUST return false. */
  probe?: (url: string) => Promise<boolean>;
  /** Load the texture by URL. Should reject (or return null) if the bytes
   *  are not a valid image. */
  load?: (url: string) => Promise<Texture | null>;
  /** Test seam: inject a custom fetch implementation for defaultProbe.
   *  Production passes the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Default URL prefix. Matches Vite's `publicDir = '../../assets'` so a
 *  PNG at `assets/sprites/characters/p0-idle-0.png` is reachable at
 *  `/sprites/characters/p0-idle-0.png`. Exposed for tests + for tooling
 *  (gen-sprites.mjs uses the same prefix when it dumps reference PNGs). */
export const SPRITE_URL_PREFIX = '/sprites/';

/** PNG magic-byte signature. The first 8 bytes of every valid PNG file. */
export const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Compose the served URL for a given logical sprite name. The name is the
 *  path under `assets/sprites/`, with or without `.png` extension. */
export function spriteUrl(name: string): string {
  const trimmed = name.startsWith('/') ? name.slice(1) : name;
  const withExt = trimmed.endsWith('.png') ? trimmed : `${trimmed}.png`;
  return `${SPRITE_URL_PREFIX}${withExt}`;
}

/** True if the first N bytes of `buf` match the PNG magic signature. */
export function isPngMagic(buf: ArrayBuffer | Uint8Array): boolean {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.length < PNG_MAGIC_BYTES.length) return false;
  for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
    if (bytes[i] !== PNG_MAGIC_BYTES[i]) return false;
  }
  return true;
}

/** True if `contentType` denotes some flavor of image. Defensive: trims +
 *  lower-cases + strips parameters (e.g. `image/png; charset=binary`). */
export function isImageContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const head = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return head.startsWith('image/');
}

/** Default probe that survives Vite's SPA history fallback.
 *
 * Issues a ranged GET for the first 8 bytes. Returns true iff:
 *   • the response is 2xx (200 or 206), AND
 *   • either the Content-Type starts with `image/` OR the body's first 8
 *     bytes are the PNG magic signature.
 *
 * SPA-fallback responses (status 200, content-type text/html, body
 * starting with `<!doctype html>`) fail BOTH checks and resolve to false.
 * Real PNGs (content-type image/png OR raw PNG bytes) pass. Network
 * errors and non-2xx responses also resolve to false; this function
 * never throws. */
async function defaultProbe(
  url: string,
  fetchImpl: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined,
): Promise<boolean> {
  if (!fetchImpl) return false;
  try {
    // Ranged GET pulls the first 8 bytes. Many static servers honor Range
    // and respond 206 with a 8-byte body; servers that ignore Range still
    // return 200 with the full file (we only read the first 8 bytes).
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: `bytes=0-${PNG_MAGIC_BYTES.length - 1}` },
    });
    if (!res.ok && res.status !== 206) return false;

    // Fast path: a trustworthy `image/*` content-type is enough. Vite dev
    // serves real PNG files with `Content-Type: image/png`; the SPA
    // fallback sends `Content-Type: text/html`.
    if (isImageContentType(res.headers.get('content-type'))) return true;

    // Slow path: read the bytes and verify the PNG magic signature.
    // Defensive guard for response objects without arrayBuffer (test mocks).
    if (typeof res.arrayBuffer !== 'function') return false;
    const buf = await res.arrayBuffer();
    return isPngMagic(buf);
  } catch {
    return false;
  }
}

/** Default texture loader using Pixi's Assets API. The static import of
 *  `pixi.js` at the top of this module is the same import every other
 *  canvas module already performs (GameStage, Character, House, …) so it
 *  carries no marginal bundle cost; keeping it static lets Rollup hoist
 *  pixi into the dedicated `pixi-vendor` manualChunk instead of warning
 *  about a mixed static+dynamic graph that won't actually code-split. */
async function defaultLoad(url: string): Promise<Texture | null> {
  try {
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
  const probe = deps.probe ?? ((u: string) => defaultProbe(u, deps.fetchImpl));
  const load = deps.load ?? defaultLoad;
  const exists = await probe(url);
  if (!exists) return null;
  return load(url);
}
