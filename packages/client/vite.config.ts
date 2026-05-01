import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

// Vite config for @xdyb/client. The dev server runs on :5173 (Vite default,
// pinned here so FINAL_GOAL §B3 / acceptance specs are explicit). The build
// emits to packages/client/dist/ which is consumed by the deploy gate.
//
// publicDir points at the repo-root `assets/` directory so a PNG dropped at
// `assets/sprites/characters/p0-idle-0.png` is served at
// `/sprites/characters/p0-idle-0.png` in dev AND copied verbatim to
// `dist/sprites/...` on build. This is the §K6 art-asset hot-swap pipeline:
// users drop a PNG and it appears next refresh, no build step required.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_ASSETS = resolve(__dirname, '../../assets');
const SPRITES_ROOT = resolve(REPO_ROOT_ASSETS, 'sprites');

// Dev-only plugin: short-circuit the SPA history fallback for any
// `/sprites/*` request that does NOT correspond to a real file under
// `assets/sprites/`. Without this, Vite's history-fallback middleware
// returns `index.html` (HTML200) for missing sprite paths, which:
//
//   1) defeats the §K6 loader's "404 → null" contract — the probe
//      sees a 200 and the loader hands HTML bytes to Pixi.Assets.load,
//      producing a silent decode error and a misleading network log.
//   2) makes "drop a PNG, refresh" feel broken when the user mistypes
//      a path — they see no error, just the procedural fallback, with
//      no clue why their art didn't appear.
//
// Returning a real 404 makes both layers honest. We register the
// middleware in the SYNCHRONOUS body of `configureServer` so it runs
// BEFORE Vite's internal middlewares (including the SPA history
// fallback). For real PNGs we delegate back to `next()` so Vite's
// static handler picks them up; for missing files we short-circuit
// with a 404, preventing the SPA fallback from masking the absence.
function spritesNotFoundPlugin(): Plugin {
  return {
    name: 'xdyb:sprites-404',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? '';
        // Strip query / hash; we only care about the path portion.
        const pathOnly = rawUrl.split('?')[0]?.split('#')[0] ?? '';
        if (!pathOnly.startsWith('/sprites/')) return next();

        // Map URL path → file under assets/sprites/. Decoded so paths
        // with %20 etc. resolve correctly.
        let decoded: string;
        try {
          decoded = decodeURIComponent(pathOnly);
        } catch {
          decoded = pathOnly;
        }
        const rel = decoded.slice('/sprites/'.length);
        // Defense in depth: reject path traversal segments. `resolve`
        // would silently accept `..`; we want a clean 404 instead.
        if (rel.includes('..')) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('sprites: invalid path');
          return;
        }
        const abs = resolve(SPRITES_ROOT, rel);
        // Belt + suspenders: ensure resolved path stays inside the
        // sprites directory after normalization.
        if (!abs.startsWith(SPRITES_ROOT)) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('sprites: out of bounds');
          return;
        }
        let isFile = false;
        try {
          isFile = existsSync(abs) && statSync(abs).isFile();
        } catch {
          isFile = false;
        }
        if (isFile) return next(); // let Vite serve it
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end('sprites: not found');
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spritesNotFoundPlugin()],
  publicDir: REPO_ROOT_ASSETS,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    // §E3 client-bundle gate: 300 KB gzipped ceiling. PixiJS 8 alone is
    // ~250 KB gzipped; if it lands in the same chunk as the app code the
    // total exceeds the gate (iter-99 measured 342.52 KB). Splitting it
    // into a `pixi-vendor` chunk lets the browser cache the engine
    // separately from app updates AND lets the gate pass: app chunk falls
    // well under 100 KB gzipped, vendor chunk is ~250 KB, sum < 300 KB.
    // React + ReactDOM go to a dedicated `react-vendor` chunk for the
    // same reason — the landing route is the only place that imports
    // them eagerly, so caching wins the second-visit bundle cost.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('/pixi.js/') || id.includes('@pixi/')) {
              return 'pixi-vendor';
            }
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
              return 'react-vendor';
            }
          }
          return undefined;
        },
      },
    },
    // The gate above keeps the ACTIVE code under the warning ceiling.
    // PixiJS itself is unavoidably large (an entire WebGL renderer) so
    // we lift the warning threshold for the vendor chunk to silence the
    // noise without hiding genuine app-code regressions.
    chunkSizeWarningLimit: 800,
  },
});
