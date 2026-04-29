// @xdyb/shared — entry point.
// Re-exports the public surface: game logic primitives and narrative pools.
// Concrete implementations land in subsequent iterations (timing, rps, engine,
// bots, narrative). For now this file establishes the package boundary so the
// pnpm workspace resolves and other packages can import via "@xdyb/shared".

export const SHARED_PACKAGE_VERSION = '0.0.1' as const;
