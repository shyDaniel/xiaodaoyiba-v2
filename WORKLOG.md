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

---

## Iteration 5 — pure round engine + Effect[] choreography (S-059)

**What:** Implemented `packages/shared/src/game/engine.ts` exporting the
pure `resolveRound(state, round, inputs, options)` function — the canonical
state-advancing primitive that sim, server, and client all consume. The
function composes `resolveRps()` (RPS majority/outlier) with action
selection (`ALIVE_CLOTHED → PULL_PANTS`, `ALIVE_PANTS_DOWN → CHOP`),
narration emission (built-in narrator with 5-variant tie pool), and
5-phase timeline tagging (PREP/RUSH/PULL_PANTS/STRIKE/IMPACT/RETURN with
`atMs` cumulative offsets summing to exactly `ACTION_TOTAL_MS`, all
imported from `timing.ts`). Also added `game/types.ts` (PlayerState,
PlayerStage, ActionKind, ActionPhase, RoundInputs) and `game/effects.ts`
(the discriminated `Effect` union — RoundStart, TieNarration, RpsResolved,
PhaseStart, Action, SetStage, Narration, GameOver — plus an
`effectsOfType<T>()` typed filter helper).

**Files changed:**
- `packages/shared/src/game/types.ts` (new — minimal core state types,
  no v1 buffs/houseHp entanglement; PlayerId/RpsChoice imported from
  `./rps.js`, not re-exported, to keep the barrel single-sourced)
- `packages/shared/src/game/effects.ts` (new — Effect discriminated
  union with timing-tagged variants; `effectsOfType<T>` typed filter)
- `packages/shared/src/game/engine.ts` (new — pure resolveRound with
  module-load self-test that the 5-phase timeline sums to
  ACTION_TOTAL_MS; PHASE_OFFSETS exported as a derived constant;
  pluggable Narrator interface; default narrator with 5 distinct
  all-equal tie variants + a separate all-same line)
- `packages/shared/src/game/engine.test.ts` (new — 16 vitest cases:
  PHASE_OFFSETS sanity, the §A acceptance 4-player RPSR scenario with
  full effect-shape assertions, tie-path emission, pants_down → CHOP
  transition with isGameOver/winnerId, DEAD-player skipping, explicit
  inputs.targets override and fallback, input-non-mutation purity guard,
  20-round mulberry32-seeded simulation verifying state monotonicity
  and per-round timeline integrity)
- `packages/shared/src/game/index.ts` (barrel re-exports `./types.js`,
  `./effects.js`, `./engine.js`)
- `ARCHITECTURE.md` (new "Round engine (canonical)" section documenting
  inputs/outputs, the action-selection rule, the self-validating phase
  timeline, and the test-coverage map)

**Observed:**
- `pnpm -r exec tsc --noEmit` exits **0** across all three packages.
- `pnpm --filter @xdyb/shared test` → **62/62 green in ~30ms** (46 rps
  + 16 engine; well under FINAL_GOAL §B1's < 5s budget).
- `pnpm test` (root) → exits 0 across all three packages.
- `pnpm build` → server tsup ESM and client vite both succeed; client
  bundle still 46.82 kB gzipped (unchanged — engine code is shared
  but not yet imported by the client; will land when Game.tsx +
  EffectPlayer arrive).
- **End-to-end driver smoke** from the server package via tsx, importing
  `@xdyb/shared`:
  - 4-player `{a:R, b:P, c:S, d:R}` (the iteration brief's acceptance
    scenario) → `winners=[a,d]`, `losers=[b,c]`, `winningChoice=ROCK`,
    `reason=majority`, 14 effects total: ROUND_START, RPS_RESOLVED,
    six PHASE_START with `atMs=[0,300,900,1800,2400,3200]` and
    `durationMs=[300,600,900,600,800,800]` summing to 4000, two
    ACTION effects at atMs=900 (`a→b PULL_PANTS`, `d→c PULL_PANTS`),
    two SET_STAGE at atMs=1300 (= PULL_PANTS + SHAME_FRAME_HOLD_MS),
    two NARRATION lines (`小红一个箭步上前，扒下了小明的裤衩` /
    `小芳一个箭步上前，扒下了小刚的裤衩`). Post-round stages exactly
    `a=ALIVE_CLOTHED b=ALIVE_PANTS_DOWN c=ALIVE_PANTS_DOWN d=ALIVE_CLOTHED`.
  - 20-round mulberry32(seed=42) random-throw sim with 4 players → game
    terminates at round 5 with winner=d, ties=1/5=20% (under the §A2
    30% gate), no exceptions, no infinite loop.

**Acceptance:** FINAL_GOAL §A's "4-player ROCK,PAPER,SCISSORS,ROCK →
winner picks loser → emits PULL_PANTS effect with phase durations
matching timing.ts" is satisfied; the 20-round simulation gate from the
iteration brief passes; the §B4 "headless sim ↔ live game timing match"
contract is now structurally enforceable because every consumer
imports from a single `timing.ts` and the engine self-validates the sum.

**Not in this iteration (deferred to next):**
- shared/game/bots/* (counter, random, iron, mirror) + seedRng.ts —
  S-022's diversifier needs the engine to call into; it's the next
  unblock now that engine.ts exists.
- shared/narrative/lines.ts — the engine ships a 5-variant tie pool +
  templated action lines as a built-in default; the richer pool
  (≥5 colloquial all-equal variants + per-action templates with
  per-player color assignment hashing for BattleLog) is its own module.
- server/sim.ts argv parser + JSONL/CSV output (now unblocked: it can
  call resolveRound + a bot to fill `inputs.choices` and stream the
  effect log).
- server Socket.IO + Room.ts + matchmaking.ts (likewise unblocked).
- client canvas/* (PixiJS GameStage / parallax / particles / camera /
  EffectPlayer consuming the engine's Effect[]).
- client Tailwind + Landing/Lobby/Game pages, BattleLog, HandPicker.
- scripts/gen-sprites.mjs + scripts/smoke-headless.mjs.
- GitHub Actions CI.

---

## Iteration 6 — viral aesthetic gate / Game page + PixiJS canvas (S-084)

**What:** Replaced the placeholder client UI (single `<h1>` + paragraph
on a radial gradient) with a real, end-to-end Game surface: a PixiJS 8
canvas with sky/sun/clouds/lantern, parallax mountain ridges, a
perspective dirt road, drifting leaves, owner-tinted houses with name
plaques, and chibi characters that hold knives, lean into RUSH, swing
in STRIKE, grab in PULL, and reveal red briefs when SHAME persists.
The page is wired to a *local* `resolveRound()` engine loop with three
bots so the product is demonstrable immediately on `pnpm dev`, before
the server gains a Room class (Socket.IO swap-in is the next iteration).

**Files added (client):**
- `packages/client/src/palette.ts` — hex palette, `playerColor()` deterministic
  hash, `toCss()` helper.
- `packages/client/src/canvas/GameStage.tsx` — owns the Pixi `Application`,
  4 parallax layers (bg/mountains/gameplay/fg), reconciles `players`
  via diff (add/remove/update), implements `computeSpots()` for n=1..6
  per FINAL_GOAL §C9 (side-by-side / triangle / square / fan).
- `packages/client/src/canvas/stage/Background.ts` — sky gradient (32-band
  rect stack), sun + halo, drifting clouds with sin-bob.
- `packages/client/src/canvas/stage/Mountains.ts` — two ridges of
  triangular peaks with snow caps.
- `packages/client/src/canvas/stage/Ground.ts` — perspective dirt road
  (trapezoid + dashed center stripe + grass tufts), exports `groundY`.
- `packages/client/src/canvas/stage/Foreground.ts` — hanging lantern with
  sway, six drifting leaves with rotation.
- `packages/client/src/canvas/stage/House.ts` — 220-px house: roof + body
  + door + 2 windows + chimney + name plaque, owner-tinted via
  `playerColor()`.
- `packages/client/src/canvas/characters/Character.ts` — chibi rig:
  shadow / legs / pants / red briefs / torso / vest / collar / belt /
  arms / knife / head / hair / eyes / mouth / sweat. State machine
  IDLE → PREP → RUSH → STRIKE → PULL → SHAME → DEAD → CHEER drives
  body lean, arm rotation, knife arc, sweat alpha; `setPantsDown(true)`
  persists across rounds (FINAL_GOAL §C7).
- `packages/client/src/components/HandPicker.tsx` — 3 chunky buttons
  with custom inline SVG hand icons (no emoji-font dependency), Chinese
  labels (石头/布/剪刀), gold flash 220 ms on press, hover scale 1.03.
- `packages/client/src/components/BattleLog.tsx` — fixed right-edge
  sidebar with verb-color-coded rows, fade-in + 800-ms gold halo on
  new entries, `colorizeActors()` recolors player names inline using
  the same `playerColor()` hash the canvas uses.
- `packages/client/src/pages/Game.tsx` — full Game surface (header with
  title + tagline + R# round + phase pill + SVG mute, player chip strip,
  GameStage host, BattleLog sidebar, footer with HandPicker). Drives a
  local engine loop: collect choice + 700 ms thinking + `resolveRound()`
  + ACTION/TIE phase replay scheduled by Effect.atMs / setTimeout, with
  `TIE_NARRATION_HOLD_MS` and `ACTION_TOTAL_MS` honored.

**Files modified:**
- `packages/client/src/App.tsx` — now renders `<GamePage />` (was a
  placeholder gradient page).

**Engineering hazards solved during the iteration:**
- *PixiJS v8 `resizeTo` + React StrictMode = `this._cancelResize is not a
  function` crash.* Fixed by passing explicit `width/height` to
  `app.init()` and managing renderer.resize() manually from the
  ResizeObserver. StrictMode double-invocation is now safe: cleanup
  guards on `cancelled` and `initialized` flags.
- *Effect[] discriminator field is `type`, not `kind`.* Re-read
  `effects.ts` and aligned all consumers (`eff.text`, `action.actor`,
  `action.target`, `action.kind`).
- *Headless chrome rendered ✊✋✌🔊💢💀 as ⊠ tofu boxes.* Replaced every
  emoji in the chrome layer with hand-drawn inline SVG (HandPicker
  rock/paper/scissors, MuteButton speaker, PlayerChip ! 裤衩 / ×死
  text glyphs).
- *BattleLog backdrop-filter blur stretched outside its bounds in
  headless chrome, painting a cloud over the right ¼ of the canvas.*
  Replaced the floating `position:absolute` overlay with a true
  full-height right rail (no backdrop-filter), and shrank the
  `<GameStage>` host + header + footer to `right: min(30vw, 360px)`
  so they no longer slide under the sidebar.
- *Pixi v8 React-StrictMode + `border` shorthand + `borderLeft` in
  React inline styles produced a runtime warning.* Switched to
  long-hand `borderTopWidth/RightWidth/BottomWidth/LeftWidth` plus
  `borderTopColor/...` so React applies them atomically.
- *Sudoless Linux box without `libnspr4`.* Used `apt-get download` (no
  root) + `dpkg-deb -x` to extract Chromium's transitive shared libs
  into `/tmp/libs/extracted`, then ran the bundled
  `chromium-1217/chrome-linux64/chrome` via Playwright with
  `LD_LIBRARY_PATH=...`. Now `node /tmp/screenshot-game.mjs` produces
  PNG screenshots end-to-end.

**Observed (Playwright screenshots, headless 1440×900):**
- *initial:* sky gradient, sun, 3 drifting clouds, hanging lantern,
  mountain ridges, perspective road, 4 owner-tinted houses with name
  plaques, 4 chibi characters with knives, R1 · 出拳 phase pill,
  speaker SVG, 4-row player chip strip, BattleLog right rail with
  "等待第一回合... 出拳！" placeholder, 3-button HandPicker
  (rock/paper/scissors SVG + Chinese labels), action hint
  "点击下方按钮选择石头/剪刀/布".
- *after-pick (700 ms post click):* ROCK button gold-flashed (selected
  highlight), header phase pill switches to · 等待 / 判定 / 动作.
- *mid-action (during ACTION_TOTAL_MS):* BattleLog populated with
  pull_pants narration `"你一个箭步上前，扒下了 小芳 的裤衩"` with
  per-player colored names + "扒" verb badge tinted red, body lean
  applied to active actor.
- *post-round (R2 starts):* persistent pants-down — player chip strip
  shows `小芳 ! 裤衩` red badge, and the green-vest character still
  has visible red briefs at the waist (FINAL_GOAL §C7 holds).

**Build/test status:**
- `pnpm typecheck` (all 3 packages): **0 errors**.
- `pnpm test` (shared): **62 / 62 passing**.
- `pnpm build` (client) gzip totals: index 142 KB +
  WebGLRenderer 19 KB + RenderTargetSystem 13 KB + browserAll 11 KB +
  WebGPURenderer 11 KB + smaller chunks ≈ **213 KB** total — well
  under the 300 KB §E3 ceiling.
- `pnpm dev` on `:5191` (5173 was occupied by v1) renders the page in
  ≈ 700 ms incl. PixiJS init.

**Acceptance:** FINAL_GOAL "VIRAL AESTHETIC GATE" — *"the screenshot at
/game must show ≥3 distinct visual elements (background + characters
+ houses) plus action-control UI"* — passes with margin: the rendered
scene shows ≥10 distinct visual elements (sky, sun, clouds, lantern,
mountains, road, 4 houses, 4 characters, knives, leaves, header,
phase pill, mute, chip strip, hand-icon picker, BattleLog with
animated rows, pants-down indicator, color-coded verb badges).

**Not in this iteration (deferred to next):**
- Server Room.ts + matchmaking.ts + Socket.IO wiring (the local
  engine loop in Game.tsx is the swap point).
- Landing / Lobby / Match-end pages (only Game.tsx is built; the
  router is `App` rendering `<GamePage />` directly for now).
- Animation polish: a real `EffectPlayer` (currently the page maps
  Effect[] inline; lifting it into `client/canvas/EffectPlayer.ts`
  is the natural next refactor).
- Sound: WebAudio mixer + sfx (the SVG mute button persists state but
  has no audio source yet).
- Client Vitest tests for the page (S-084 was a visual gate; future
  iterations should add `.test.tsx` for HandPicker / BattleLog logic).
- GitHub Actions CI.


---

## iter-13 (S-195) — recover iter-7 in-flight work: wire EffectPlayer into Game.tsx

Iter-7 left a half-wired tree behind: `EffectPlayer.ts` (new file),
`Character.ts` (RUSH/RETURN tween + topPants slide methods), and
`GameStage.tsx` (controllerRef + scene refs) had been written but
never invoked from React. Game.tsx still scheduled phase narration
via `setTimeout` in component scope and the canvas was deaf to
engine events — characters stood still through the whole "冲到对方
家里" choreography. This is the v1 entanglement v2 was meant to
delete; the iter-7 worker stopped one wire short of the cut.

This iteration finishes the wire:

- `Game.tsx` holds a `stageRef: MutableRefObject<StageController>`
  and passes it to `<GameStage controllerRef={stageRef} />`.
- `submitChoice` no longer schedules per-narration `setTimeout`s.
  It calls `stageRef.current.play(result.effects, playerStates,
  { onNarration })` and awaits the returned promise — the canvas
  EffectPlayer dispatches PREP/RUSH/PULL/STRIKE/RETURN at the
  canonical timing.ts offsets, and `onNarration` appends BattleLog
  rows in lockstep with the on-stage beat.
- After each round, `stageRef.current.reset(...)` snaps survivors
  back to homeX + IDLE so the next round starts from a clean pose
  without clobbering DEAD/PANTS_DOWN persistence.
- Tie path uses the same `play()` call (EffectPlayer holds for
  TIE_NARRATION_HOLD_MS internally). Defensive fallback (Pixi not
  yet ready) emits log rows + sleeps so phase still advances.
- Removed the `void PHASE_T_PULL_PANTS` placeholder that had
  marked the unfinished hook.

`pnpm -r build` green (shared tsc, server tsup, client vite — 449 KB
JS / 143 KB gzip with PixiJS). `pnpm test` green (62 shared tests).

**Observed in dev**: round flow now completes end-to-end through
the canvas: actor sprites RUSH across the stage with ease-out lean,
victim's `topPants` y-slides waist→ankle revealing red briefs over
PHASE_T_PULL_PANTS (900 ms), `setPantsDown(true)` locks in so the
briefs persist across subsequent rounds, RETURN tween eases the
attacker home over PHASE_T_RETURN (800 ms), and BattleLog rows land
at atMs=900 (扒) and atMs=1800 (砍). No more frozen sprites mid-
narration.

**Not in this iteration (still outstanding from verdict):**
- Headless sim CLI in `packages/server/src/sim.ts` (still a stub).
- Bot registry + seeded RNG in `packages/shared/src/game/bots/`.
- Particle systems / camera / screen shake / audio.
- Socket.IO Room + Landing/Lobby pages.
- GitHub Actions CI.


---

## iter-15 (S-201) — audio module: zzfx + ZzFXM-style BGM cross-fade (FINAL_GOAL §D)

`packages/client/src/audio/` did not exist. The mute SVG button in
`Game.tsx` toggled a piece of React state and persisted to
`localStorage['xdyb.muted']` but no audio source existed downstream:
no AudioContext, no SFX, no BGM. FINAL_GOAL §D1/§D2/§D3 was
entirely unimplemented.

This iteration ports v1's ZzFX synth verbatim, layers a tracker-style
3-variant BGM driver with auto cross-fade on top, wires the SFX into
the existing Effect[] choreography in `EffectPlayer`, and connects
the mute button to a real audio source.

**Files added:**

- `packages/client/src/audio/zzfx.ts` — Zuper Zmall Zound Zynth port
  from v1 (FINAL_GOAL §D1 reuse pointer). Lazy AudioContext
  unlock-on-gesture; `play(name)` is a no-op when muted or AudioContext
  is unavailable (jsdom). Persists mute under `xdyb.muted` to keep
  Game.tsx's existing key. Exports `onMuteChange()` so bgm.ts can
  pause its driver when muted.
- `packages/client/src/audio/presets.ts` — 11 named presets
  (`tap`, `reveal`, `pull`, `clothTear`, `gasp`, `chop`, `dodge`,
  `thud`, `roundStart`, `victory`, `defeat`) — covers the 9
  FINAL_GOAL §D1 mandatory names plus 2 helpers used by the
  pull-pants choreography.
- `packages/client/src/audio/bgm.ts` — 3-variant BGM
  (`lobby`/`battle`/`victory`) with cross-fade. Each variant is a
  16-step pentatonic lead+bass loop dispatched through the shared
  `zzfx()` voice. Cross-fade scales per-tick volume linearly
  between active and previous variant over `CROSSFADE_DURATION_MS`
  (400 ms — within the FINAL_GOAL §D2 ≤500 ms budget). Logical
  clock decoupled from `performance.now()` so vitest fake timers
  drive the ramp deterministically.
- `packages/client/src/audio/index.ts` — barrel export.
- `packages/client/src/audio/audio.test.ts` — 12 vitest cases:
  mute persistence (key + round-trip + survives module reload),
  preset enumeration (the 9 §D1 names), cross-fade lands within
  budget, mute-mid-loop preserves variant, etc.
- `packages/client/vitest.config.ts` — separate from `vite.config.ts`
  so the test harness uses jsdom without affecting the build pipeline.

**Files modified:**

- `packages/client/src/components/HandPicker.tsx` — `onClick` now
  calls `unlockAudio()` then `play('tap')` so the very first user
  gesture unlocks the AudioContext, satisfying §D3 autoplay-policy.
- `packages/client/src/canvas/EffectPlayer.ts` — wires SFX into the
  Effect[] choreography. `reveal` on tie + action opener; `pull`
  + `clothTear` + delayed `gasp` at PULL_PANTS; `chop` + delayed
  `thud` at CHOP STRIKE.
- `packages/client/src/pages/Game.tsx` — replaces inline mute state
  with `audioIsMuted()`/`audioSetMuted()`, mounts BGM with
  `startBgm('lobby')`, cross-fades to `battle` during ACTION/RESOLVE/
  TIE phases, to `victory` on game-over, back to `lobby` on result
  screen. `playSfx('roundStart')` chimes between rounds; final
  outcome triggers `victory` or `defeat` SFX. Mute button onToggle
  calls `unlockAudio()` first so re-unmuting after page-load actually
  resumes audio.

**Observed:**
- `pnpm test` green: 62 shared + 12 client = **74 tests passing**.
- `pnpm -r typecheck` green across all 3 packages.
- `pnpm build` green: client gzip = **146 kB** (FINAL_GOAL §E ≤300 kB
  passed with margin), server tsup 21 ms, shared tsc clean.
- Cross-fade test: `setVariant('battle')` after `startBgm('lobby')`
  reports `isCrossfading()===true`; advancing fake timers by 600 ms
  (CROSSFADE_DURATION_MS + 200) flips it to `false` with active
  variant `battle` — §D2 budget asserted at runtime via
  `expect(CROSSFADE_DURATION_MS).toBeLessThanOrEqual(500)`.
- Module reload test: `localStorage.setItem('xdyb.muted', '1')` →
  `vi.resetModules()` → fresh `import('./zzfx.js')` reports
  `isMuted()===true` — §D3 persistence-survives-reload asserted.

**Not in this iteration (still outstanding from verdict):**
- Headless sim CLI in `packages/server/src/sim.ts` (still a stub).
- Bot registry + seeded RNG in `packages/shared/src/game/bots/`.
- Particle systems / camera / screen shake.
- Socket.IO Room + Landing/Lobby pages.
- GitHub Actions CI.

---

## Iteration 16 — S-220 (.github/workflows/ci.yml)

Added `.github/workflows/ci.yml` — the §E5 green-gate-to-merge prerequisite.
Workflow runs on push + PR to main, uses `pnpm/action-setup@v4` (pnpm 9.15.9)
+ `actions/setup-node@v4` (Node 20, pnpm-store cached), then runs
`pnpm install --frozen-lockfile`, `pnpm test`, `pnpm build`, and the
acceptance smoke `pnpm sim --players 4 --bots counter,random,iron,mirror
--rounds 20 --seed 1`. YAML parses clean (validated with `python3 -c
"import yaml; yaml.safe_load(open(...))"`); locally `pnpm test` passes
74 tests, `pnpm build` produces server + client bundles, `pnpm sim ...`
exits 0 (today still the bootstrap stub — flag plumbing comes with the
sim engine subtask, but the workflow already invokes the canonical
acceptance command so it auto-tightens once sim is wired).
