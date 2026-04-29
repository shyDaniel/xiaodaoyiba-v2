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
- shared/game/rps.ts (the N≥3 fix)
- shared/game/engine.ts (resolveRound)
- shared/game/bots/* (counter, random, iron, mirror, seedRng)
- shared/narrative/lines.ts (≥5 tie variants)
- server/sim.ts wiring to the engine
- client React + PixiJS bring-up
- Vitest configuration
- Vite + Tailwind + PostCSS configuration
- GitHub Actions CI

---

## Iteration 2 — shared timing constants (S-021)

**What:** Implemented `packages/shared/src/game/timing.ts` exporting the 8
canonical phase-duration constants from FINAL_GOAL §A5 and re-exported them
from `shared/game/index.ts` and `shared/src/index.ts` so server / sim / client
all read from one source.

**Files changed:**
- `packages/shared/src/game/timing.ts` (new — 8 named exports + phase-budget
  documentation)
- `packages/shared/src/game/index.ts` (replaced `export {}` with
  `export * from './timing.js'`)
- `packages/shared/src/index.ts` (re-exports `./game/index.js`)

**Observed:**
- `pnpm -r exec tsc --noEmit` exits **0** across all three packages.
- Runtime sanity check via tsx confirms every constant matches the spec
  byte-for-byte: `PREP=300 RUSH=600 PULL_PANTS=900 STRIKE=600 IMPACT=800
  RETURN=800 TOTAL=4000 TIE=2000 SHAME=400`. The five-phase sum
  `PREP+RUSH+PULL_PANTS+STRIKE+IMPACT+RETURN = 4000 = ACTION_TOTAL_MS`,
  so the choreography budget is internally consistent.
- Acceptance gate from the brief: `grep -rE "\b(4000|2400|1800|3200|900|800|600|300)\b" packages/{server,client}/src`
  returns no matches — there are zero hard-coded duplicates of these magic
  numbers anywhere outside `@xdyb/shared`. Existing
  `SHARED_PACKAGE_VERSION` consumers in server/client are unaffected.

**Not in this iteration (deferred to next):**
- shared/game/rps.ts (the N≥3 fix)
- shared/game/engine.ts (resolveRound)
- shared/game/bots/* (counter, random, iron, mirror, seedRng)
- shared/narrative/lines.ts (≥5 tie variants)
- server/sim.ts wiring + Socket.IO Room
- client React + PixiJS bring-up
- Vitest configuration, CI

---

## Iteration 3 — multi-player RPS resolver (S-022)

**What:** Implemented `packages/shared/src/game/rps.ts` with the N≥3 fix
mandated by FINAL_GOAL §A2. `resolveRps(choices)` handles `unique.size === 3`
by majority-wins (one shape strictly highest → that shape advances), with a
lone-outlier tiebreak when ≥2 shapes are tied at the top (one shape strictly
lowest → that shape advances). `{R:k,P:k,S:k}` is a documented tie
(`reason: 'all-equal'`). The 2-way path preserves classical RPS — the
winning *shape* (per `BEATS`), not the majority headcount, decides who
advances (4 SCISSORS + 2 ROCK ⇒ ROCK wins; regression guard included).

**Files changed:**
- `packages/shared/src/game/rps.ts` (new — pure, no I/O, accepts both
  `Record<PlayerId, RpsChoice>` and `Iterable<[id, choice]>` inputs;
  exports `RpsChoice`, `PlayerId`, `RPS_CHOICES`, `resolveRps`,
  `RpsResolution` with a discriminated `reason` field for
  narration/test introspection).
- `packages/shared/src/game/rps.test.ts` (new — 46 vitest cases covering
  the 1/2/3-distinct × 2/3/4/5/6-player matrix, plus purity, determinism,
  insertion-order preservation, and an explicit v1 regression block).
- `packages/shared/src/game/index.ts` (re-exports `./rps.js`).
- `packages/server/package.json`, `packages/client/package.json` — added
  `--passWithNoTests` to the `test` script so the root `pnpm test` exits 0
  while server/client packages have no tests yet (without this, the empty
  packages caused the canonical acceptance command to fail with "No test
  files found").
- `ARCHITECTURE.md` — new "N≥3 RPS resolution rule (canonical)" section
  with the full truth-table and the 2-way nuance documented.

**Observed:**
- `pnpm -r exec tsc --noEmit` exits 0 across all three packages.
- `pnpm --filter @xdyb/shared test` → **46/46 green in 16ms** (well under
  the §B1 < 5s budget).
- `pnpm test` from the root → **exits 0**; shared reports 46 passed,
  server and client report "No test files found, exiting with code 0".
- End-to-end smoke through `@xdyb/shared` from the server package
  (`pnpm --filter @xdyb/server exec tsx -e ...`): the barrel re-exports
  `resolveRps`, `RPS_CHOICES`, and `ACTION_TOTAL_MS` at the same level;
  worked examples match runtime output exactly:
  - `{a:R,b:P,c:S}` → `tie:true, reason:'all-equal'`
  - `{a:R,b:R,c:P,d:S}` → winners `['a','b']`, losers `['c','d']`,
    winningChoice `ROCK`, reason `majority`
  - `{a:R,b:R,c:P,d:P,e:S}` → winners `['e']`, losers `['a','b','c','d']`,
    winningChoice `SCISSORS`, reason `outlier`
  - `{a:R,b:R,c:P,d:P,e:S,f:S}` → `tie:true, reason:'all-equal'`
  - `{a:R,b:R,c:R}` → `tie:true, reason:'all-same'`
  - `{a:R,b:P}` → winners `['b']`, losers `['a']`, winningChoice `PAPER`,
    reason `two-way`

**v1 regression guard:** the test file's final `describe` block enumerates
7 inputs (4/5/6-player rooms with all three shapes thrown) that v1's
`unique.size !== 2 → tie` rule would have forced into a tie; five now
resolve cleanly under majority/outlier rules and only the two with
genuinely-equal counts remain tied. FINAL_GOAL §A2 ("`unique.size === 3`
is **handled**, not treated as automatic tie") is satisfied.

**Not in this iteration (deferred to next):**
- shared/game/engine.ts (pure resolveRound wrapping resolveRps + action
  selection + narration emission)
- shared/game/bots/* (counter, random, iron, mirror, seedRng with
  mulberry32)
- shared/narrative/lines.ts (≥5 tie variants — needed so consecutive
  `outlier` / `all-equal` ties read as different sentences)
- server/sim.ts wiring + Socket.IO Room + matchmaking
- client React + PixiJS bring-up
- GitHub Actions CI
