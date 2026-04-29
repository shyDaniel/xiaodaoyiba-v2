# WORKLOG.md — xiaodaoyiba v2

Append-only iteration log. Latest entry at the bottom.

---

## Iteration 1 — workspace bootstrap (S-001)

**What:** Created the pnpm workspace root and the three packages
(`@xdyb/shared`, `@xdyb/server`, `@xdyb/client`) with strict-mode
TypeScript configs and stub entry points so the package graph resolves.

**Files added:**
- `package.json` (workspace root, scripts: dev/build/test/typecheck/sim/lint)
- `pnpm-workspace.yaml`
- `tsconfig.base.json` (strict mode + noUncheckedIndexedAccess + isolatedModules)
- `.npmrc` (link-workspace-packages, auto-install-peers)
- `packages/shared/{package.json,tsconfig.json,src/index.ts,src/game/index.ts,README.md}`
- `packages/server/{package.json,tsconfig.json,src/index.ts,src/sim.ts,README.md}`
- `packages/client/{package.json,tsconfig.json,src/main.ts,README.md}`
- `README.md`, `ARCHITECTURE.md`, `WORKLOG.md` at repo root.

**Observed:**
- `pnpm install` from the freshly scaffolded workspace completed in **4.6s**
  (acceptance gate ≤ 60s, FINAL_GOAL §E1 — passed with margin).
- `pnpm -r exec tsc --noEmit` exits **0** across all three packages — the
  iteration-1 acceptance test the brief asked for.
- The stubs deliberately import `SHARED_PACKAGE_VERSION` from `@xdyb/shared`
  in both server and client to verify the workspace symlink + tsconfig
  module resolution actually work end-to-end, not just per-package.

**Not in this iteration (deferred to next):**
- shared/game/timing.ts constants
- shared/game/rps.ts (the N≥3 fix)
- shared/game/engine.ts (resolveRound)
- shared/game/bots/* (counter, random, iron, mirror, seedRng)
- shared/narrative/lines.ts (≥5 tie variants)
- server/sim.ts wiring to the engine
- client React + PixiJS bring-up
- Vitest configuration
- Vite + Tailwind + PostCSS configuration
- GitHub Actions CI
