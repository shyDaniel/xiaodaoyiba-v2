import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for @xdyb/client. The dev server runs on :5173 (Vite default,
// pinned here so FINAL_GOAL §B3 / acceptance specs are explicit). The build
// emits to packages/client/dist/ which is consumed by the deploy gate.
export default defineConfig({
  plugins: [react()],
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
