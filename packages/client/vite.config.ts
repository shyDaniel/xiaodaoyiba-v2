import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

export default defineConfig({
  plugins: [react()],
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
  },
});
