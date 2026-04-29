import { defineConfig } from 'vitest/config';

// Separate vitest config from Vite's so the test harness uses jsdom
// without affecting the dev/build toolchain. The client tests cover the
// audio module surface (mute persistence, preset enumeration, BGM cross-
// fade contract); future iterations layer in component-level tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
});
