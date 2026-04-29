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

---

## Iteration 4 — client Vite entry + React bring-up (S-045)

**What:** Unbroke `pnpm build`. The client package had no `index.html`,
no `vite.config.ts`, and `src/main.ts` was a console.log stub — Vite
exited with `Could not resolve entry module index.html`. Created the
Vite entry HTML, the React entrypoint, a placeholder `App.tsx` shell,
and a Vite config wired for `@vitejs/plugin-react` + the spec port
(5173, strictPort). Removed the obsolete `main.ts` stub.

**Files changed:**
- `packages/client/index.html` (new — `<div id="root">` +
  `<script type="module" src="/src/main.tsx">`, inline base styles
  to avoid a flash-of-blank-page before React mounts)
- `packages/client/src/main.tsx` (new — `ReactDOM.createRoot` mount
  inside `React.StrictMode`, throws if `#root` missing, keeps the
  v1-style `[xdyb-client] bootstrap` console line so the existing
  workspace smoke-trace still works)
- `packages/client/src/App.tsx` (new — placeholder shell rendering
  the rhyme `小刀一把，来到你家，扒你裤衩，直接咔嚓！` so dev/preview
  no longer shows a blank page; pure inline styles, no Tailwind dep
  yet — that arrives with the real Landing/Lobby pages)
- `packages/client/vite.config.ts` (new — `@vitejs/plugin-react`,
  `server.port: 5173 strictPort: true`, build target ES2022,
  sourcemaps on for the bring-up phase)
- `packages/client/src/main.ts` (deleted — superseded by main.tsx)

**Observed:**
- `pnpm --filter @xdyb/client build` → exits 0; produces
  `dist/index.html` (0.84 kB → 0.48 kB gzip) and
  `dist/assets/index-*.js` (143.60 kB → **46.51 kB gzip**, well
  under the FINAL_GOAL §E3 300 kB ceiling for the code portion).
- `pnpm build` (root) → all three packages build: shared (no-op),
  server tsup ESM build success, client vite build success.
- `pnpm --filter @xdyb/client typecheck` → exits 0.
- `pnpm test` (root) → exits 0; shared still 46/46 in 16 ms,
  client vitest exits 0 with no test files (passWithNoTests).
- Dev-server smoke (started on :5201 because v1's vite already
  owned :5173 — config still pins 5173 for the actual workflow):
  `GET /` → 200 with the expected `<title>小刀一把 · xiaodaoyiba</title>`,
  `<div id="root">`, `<script src="/src/main.tsx">`. `GET /src/main.tsx`
  → 200, transformed JSX with React-Refresh hooks injected.
  `GET /@fs/.../shared/src/index.ts` → 200, confirming the workspace
  symlink resolves through Vite at dev time.
- **End-to-end runtime smoke** (jsdom, no Chromium needed): loaded
  the *built* bundle into a JSDOM document, executed it, observed
  `#root.children = 1`, `innerHTML` 765 chars, `<h1>` text =
  `小刀一把`, console emits `[xdyb-client] bootstrap — shared@0.0.1
  action=4000ms`, **zero runtime errors**. React mount works on the
  production bundle, not just in dev.

**Acceptance:** FINAL_GOAL §E3 build gate (`pnpm build` exits 0
producing `packages/client/dist/index.html` + JS bundle) — passes.
The client package can now be served / iterated on; subsequent
iterations layer in Tailwind, the Landing/Lobby/Game pages, the
PixiJS GameStage, and Socket.IO wiring on top of this entry.

**Not in this iteration (still deferred):**
- shared/game/engine.ts (resolveRound)
- shared/game/types.ts + effects.ts
- shared/game/bots/* + seedRng.ts
- shared/narrative/lines.ts (≥5 tie variants)
- server/sim.ts argv parsing + JSONL output (S-046 candidate)
- server Socket.IO + Room.ts + matchmaking.ts
- client Tailwind config / Landing / Lobby / Game pages
- client canvas/* (PixiJS GameStage, parallax, particles, camera)
- client store/socket/audio/palette
- scripts/gen-sprites.mjs + scripts/smoke-headless.mjs
- GitHub Actions CI (.github/workflows/ci.yml)
