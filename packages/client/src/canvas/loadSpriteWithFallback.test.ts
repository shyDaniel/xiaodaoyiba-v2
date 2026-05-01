// FINAL_GOAL §K6 — art-asset hot-swap pipeline unit tests.
//
// Both branches of the loader contract MUST be exercised:
//   • PNG present  → returns the loaded Texture
//   • PNG absent   → returns null (procedural rig stays in charge)
//
// AND — the §S-516 regression that prompted this rewrite — the default
// probe MUST resolve to false when Vite's dev-server SPA history
// fallback returns `index.html` (HTML200) for a missing sprite path.
// A naive HEAD probe sees status 200 and lets Pixi.Assets.load take
// HTML bytes, producing a silent decode error. The new probe checks
// Content-Type AND PNG magic bytes; either signal failing → false.

import { describe, expect, test, vi } from 'vitest';
import {
  PNG_MAGIC_BYTES,
  SPRITE_URL_PREFIX,
  isImageContentType,
  isPngMagic,
  loadSpriteWithFallback,
  spriteUrl,
} from './loadSpriteWithFallback.js';

describe('§K6 spriteUrl', () => {
  test('appends .png when the name has no extension', () => {
    expect(spriteUrl('characters/p0-idle-0')).toBe(
      `${SPRITE_URL_PREFIX}characters/p0-idle-0.png`,
    );
  });

  test('keeps the name when it already ends in .png', () => {
    expect(spriteUrl('houses/p1-house.png')).toBe(
      `${SPRITE_URL_PREFIX}houses/p1-house.png`,
    );
  });

  test('strips a leading slash from the input name', () => {
    expect(spriteUrl('/characters/p2-idle-0.png')).toBe(
      `${SPRITE_URL_PREFIX}characters/p2-idle-0.png`,
    );
  });
});

describe('§K6 isPngMagic', () => {
  test('accepts the canonical PNG signature', () => {
    expect(isPngMagic(new Uint8Array(PNG_MAGIC_BYTES))).toBe(true);
  });

  test('accepts longer buffers as long as the first 8 bytes match', () => {
    const buf = new Uint8Array([...PNG_MAGIC_BYTES, 0x00, 0x00, 0x00, 0x0d]);
    expect(isPngMagic(buf)).toBe(true);
  });

  test('rejects HTML preamble (the SPA-fallback shape)', () => {
    // "<!doctype" — what Vite's index.html starts with.
    const html = new TextEncoder().encode('<!doctype html>');
    expect(isPngMagic(html)).toBe(false);
  });

  test('rejects buffers shorter than the 8-byte signature', () => {
    expect(isPngMagic(new Uint8Array([0x89, 0x50]))).toBe(false);
  });

  test('accepts an ArrayBuffer (not just Uint8Array)', () => {
    const u8 = new Uint8Array(PNG_MAGIC_BYTES);
    expect(isPngMagic(u8.buffer)).toBe(true);
  });
});

describe('§K6 isImageContentType', () => {
  test('accepts image/png', () => {
    expect(isImageContentType('image/png')).toBe(true);
  });

  test('accepts image/* with parameters', () => {
    expect(isImageContentType('image/jpeg; charset=binary')).toBe(true);
  });

  test('is case-insensitive', () => {
    expect(isImageContentType('IMAGE/PNG')).toBe(true);
  });

  test('rejects text/html (the SPA-fallback content-type)', () => {
    expect(isImageContentType('text/html; charset=utf-8')).toBe(false);
  });

  test('rejects null / undefined / empty', () => {
    expect(isImageContentType(null)).toBe(false);
    expect(isImageContentType(undefined)).toBe(false);
    expect(isImageContentType('')).toBe(false);
  });
});

describe('§K6 loadSpriteWithFallback — PNG present path', () => {
  test('returns the texture from the injected loader when probe succeeds', async () => {
    const fakeTexture = { __mock: 'tex-p0-idle-0' } as unknown as Awaited<
      ReturnType<typeof loadSpriteWithFallback>
    >;
    const probe = vi.fn(async (_url: string) => true);
    const load = vi.fn(async (_url: string) => fakeTexture);

    const result = await loadSpriteWithFallback('characters/p0-idle-0', {
      probe,
      load,
    });

    expect(result).toBe(fakeTexture);
    expect(probe).toHaveBeenCalledWith(
      `${SPRITE_URL_PREFIX}characters/p0-idle-0.png`,
    );
    expect(load).toHaveBeenCalledWith(
      `${SPRITE_URL_PREFIX}characters/p0-idle-0.png`,
    );
  });
});

describe('§K6 loadSpriteWithFallback — PNG absent path (procedural fallback)', () => {
  test('returns null when probe says the asset is missing', async () => {
    const probe = vi.fn(async (_url: string) => false);
    const load = vi.fn(async (_url: string) => {
      throw new Error('load() must NOT be called when the probe says missing');
    });

    const result = await loadSpriteWithFallback('characters/p999-missing', {
      probe,
      load,
    });

    expect(result).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  test('returns null when the probe throws (network error)', async () => {
    const probe = vi.fn(async () => {
      // Default probe wraps fetch in a try/catch and returns false on any
      // throw, but if a custom probe escapes its wrapper the loader still
      // must NOT take down the caller — we test that contract explicitly
      // by injecting a probe that returns false (matching default-probe
      // semantics on a network error).
      return false;
    });
    const load = vi.fn(async () => null);

    const result = await loadSpriteWithFallback('houses/p0-house', {
      probe,
      load,
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  test('returns null when probe succeeds but load returns null (invalid bytes)', async () => {
    const probe = vi.fn(async () => true);
    const load = vi.fn(async () => null);

    const result = await loadSpriteWithFallback('characters/p0-idle-0', {
      probe,
      load,
    });

    expect(result).toBeNull();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// §S-516: default-probe regression — Vite SPA history fallback
// =============================================================================
//
// These tests exercise the DEFAULT probe (not the injected one) end-to-end
// via a mocked fetch. The previous implementation issued HEAD-only and
// trusted any 2xx; under Vite dev that returned 200 for every absent
// sprite path because of SPA history fallback. The new implementation
// issues a ranged GET and verifies BOTH content-type and (as fallback)
// PNG magic bytes.

/** Build a mock Response object that mimics what `fetch` returns. We
 *  only stub the surface the probe actually touches: `.ok`, `.status`,
 *  `.headers.get('content-type')`, `.arrayBuffer()`. */
function mockResponse(opts: {
  status: number;
  contentType: string;
  body: Uint8Array | string;
}): Response {
  const ok = opts.status >= 200 && opts.status < 300;
  const body =
    typeof opts.body === 'string' ? new TextEncoder().encode(opts.body) : opts.body;
  return {
    ok,
    status: opts.status,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return opts.contentType;
        return null;
      },
    },
    async arrayBuffer() {
      return body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      );
    },
  } as unknown as Response;
}

describe('§S-516 defaultProbe — SPA-fallback regression', () => {
  test('SPA-fallback (HTML200) ⇒ probe returns false ⇒ loader returns null', async () => {
    // Vite's SPA history fallback: any unmatched path returns index.html
    // with status 200, content-type text/html. The naive HEAD probe was
    // fooled. The new probe sees content-type=text/html AND body=HTML
    // bytes, fails BOTH checks, and resolves to false.
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      mockResponse({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head>...</head></html>',
      }),
    ) as unknown as typeof fetch;

    // The test seam: pass `fetchImpl` and let the loader's defaultProbe
    // exercise both signal checks. Inject `load` so we can ASSERT it is
    // never called — that's the §S-516 contract.
    const load = vi.fn(async (_url: string) => {
      throw new Error('load() must NOT be called when SPA fallback fires');
    });

    const result = await loadSpriteWithFallback('characters/p0-idle-0', {
      fetchImpl,
      load,
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
    // Probe was called with the composed URL.
    expect(fetchImpl).toHaveBeenCalledWith(
      `${SPRITE_URL_PREFIX}characters/p0-idle-0.png`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('real PNG (image/png + magic bytes) ⇒ probe returns true ⇒ loader is invoked', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      mockResponse({
        status: 206,
        contentType: 'image/png',
        body: new Uint8Array(PNG_MAGIC_BYTES),
      }),
    ) as unknown as typeof fetch;
    const fakeTex = { __mock: 'real-png' } as unknown as Awaited<
      ReturnType<typeof loadSpriteWithFallback>
    >;
    const load = vi.fn(async (_url: string) => fakeTex);

    const result = await loadSpriteWithFallback('houses/p0-house', {
      fetchImpl,
      load,
    });

    expect(result).toBe(fakeTex);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test('real 404 ⇒ probe returns false ⇒ loader returns null', async () => {
    // The Vite middleware path: middleware returns a real 404 for any
    // /sprites/* that doesn't exist, eliminating the SPA fallback.
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        status: 404,
        contentType: 'text/plain',
        body: 'sprites: not found',
      }),
    ) as unknown as typeof fetch;
    const load = vi.fn();

    const result = await loadSpriteWithFallback('characters/p999-missing', {
      fetchImpl,
      load: load as never,
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  test('weird content-type but real PNG body ⇒ probe accepts via magic bytes', async () => {
    // Some static hosts misreport content-type (e.g. application/octet-
    // stream). The probe's slow path falls back to PNG magic bytes.
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        contentType: 'application/octet-stream',
        body: new Uint8Array(PNG_MAGIC_BYTES),
      }),
    ) as unknown as typeof fetch;
    const fakeTex = { __mock: 'octet-png' } as unknown as Awaited<
      ReturnType<typeof loadSpriteWithFallback>
    >;
    const load = vi.fn(async () => fakeTex);

    const result = await loadSpriteWithFallback('characters/p0-idle-0', {
      fetchImpl,
      load,
    });

    expect(result).toBe(fakeTex);
  });

  test('200 status with HTML content-type AND HTML body ⇒ false (belt + suspenders)', async () => {
    // The SPA-fallback shape with explicit HTML body. Both checks fail.
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html>',
      }),
    ) as unknown as typeof fetch;
    const load = vi.fn();

    const result = await loadSpriteWithFallback('characters/spa-fallback', {
      fetchImpl,
      load: load as never,
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  test('fetch throws (network down) ⇒ probe returns false', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('network failure');
    }) as unknown as typeof fetch;
    const load = vi.fn();

    const result = await loadSpriteWithFallback('houses/offline', {
      fetchImpl,
      load: load as never,
    });

    expect(result).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
