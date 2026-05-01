# ARCHITECTURE.md — xiaodaoyiba v2

> Status: **iteration-1 scaffold.** Concrete module implementations land in
> subsequent iterations; this document captures the design that the
> bootstrap obeys.

## High-level shape

```
┌──────────────────┐    HTTP/WebSocket     ┌──────────────────┐
│  @xdyb/client    │ ─────────────────────▶│  @xdyb/server    │
│  Vite + React +  │   Socket.IO  Effect[] │  Socket.IO :3000 │
│  PixiJS 8 canvas │ ◀─────────────────────│  + pnpm sim CLI  │
└────────┬─────────┘                       └────────┬─────────┘
         │                                          │
         └──────── imports ──┐         ┌── imports ─┘
                             ▼         ▼
                     ┌─────────────────────┐
                     │  @xdyb/shared       │
                     │  pure game logic    │
                     │  ─────────────────  │
                     │  timing.ts (§A5)    │
                     │  rps.ts (§A2 fix)   │
                     │  engine.ts (pure)   │
                     │  bots/* (§A3, §A4)  │
                     │  narrative/lines.ts │
                     └─────────────────────┘
```

`@xdyb/shared` is **pure**: no DOM, no Node, no Socket.IO, no PixiJS, no
React. It is consumed by all three of (browser, Socket.IO server, headless
sim CLI). This is the structural fix for the v1 problem where animation
constants and game logic leaked into the renderer.

## Why three packages, not one

| Package         | Lives in           | Imports                         |
| --------------- | ------------------ | ------------------------------- |
| `@xdyb/shared`  | Node + browser     | nothing                         |
| `@xdyb/server`  | Node only          | `@xdyb/shared`, `socket.io`     |
| `@xdyb/client`  | Browser only       | `@xdyb/shared`, `pixi.js`, `react`, `socket.io-client` |

Single source of truth for timing means the headless sim and the live game
animate on the same clock (FINAL_GOAL §B4). The sim records each phase's
duration; the live server uses the same `timing.ts` constants. There is one
canonical timeline, not two.

## Effect[] protocol (forward-looking)

The server resolves a round via `@xdyb/shared/game/engine.resolveRound()` and
emits an ordered `Effect[]` array — each Effect is a `(t_offset_ms, kind,
payload)` triple. The client's `EffectPlayer.ts` schedules canvas calls at
the correct offsets. This is the primary client/server contract; React store
state holds room snapshot only, never animation state (FINAL_GOAL §C1).

## TypeScript strict mode (tsconfig.base.json)

`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noImplicitReturns`. No `any` escape hatches in
committed code. Every package extends this base.

## Why PixiJS / why headless / why fixed RPS

- **PixiJS:** v1's HTML/CSS pixel-art at 32×32 native + `image-rendering:
  pixelated` cannot reach Steam-indie polish. PixiJS gives us real particle
  systems, multi-layer parallax, camera shake, and blend modes on a single
  canvas — without re-rendering React on every sprite tick.
- **Headless sim:** AI agents (including this autopilot) iterate game logic
  10× faster when they can run 50 rounds in <2s without spinning up Chrome.
  `pnpm sim` is that tool.
- **Fixed RPS:** v1 treated `unique.size !== 2` as tie, so 1 OR 3 distinct
  shapes among N≥3 players counted as tie — combined with all bots sharing
  one RNG and one strategy, players perceived "all ties." v2 resolves N≥3
  with majority-wins (and if no majority, players with the unique-shape
  advance), and gives each bot its own seeded RNG + diversified strategy
  (counter / random / iron / mirror, round-robin assigned).

### N≥3 RPS resolution rule (canonical)

`packages/shared/src/game/rps.ts:resolveRps()` — pure, no I/O. Behaviour by
number of distinct shapes thrown:

| `unique.size` | Counts                          | Outcome                                       | `reason`     |
| ------------- | ------------------------------- | --------------------------------------------- | ------------ |
| 1             | e.g. {R:n}                      | tie                                           | `all-same`   |
| 2             | e.g. {R:a, P:b}                 | classical RPS — winning shape advances        | `two-way`    |
| 3 (majority)  | one shape strictly highest      | majority shape's players win, others lose     | `majority`   |
| 3 (outlier)   | tie at top, one shape strictly lowest | lone-shape players win ("outlier survives") | `outlier`    |
| 3 (all equal) | {R:k, P:k, S:k}                 | tie                                           | `all-equal`  |
| 0 throws      | empty                           | tie                                           | `empty`      |

Important nuance for the 2-way case: the **winning shape**, not the
**majority headcount**, decides who advances. 4 SCISSORS + 2 ROCK is a
ROCK win, not a SCISSORS win — the `BEATS` relation is canonical, not
democratic. Only the 3-way path (where there is no single beats-relation
to apply) falls back to counting heads.

The truth-table coverage lives in `packages/shared/src/game/rps.test.ts`
(46 cases across the 1/2/3-distinct × 2/3/4/5/6-player matrix), and is the
explicit regression guard against the v1 `unique.size !== 2 → tie` bug.

### Round engine (canonical)

`packages/shared/src/game/engine.ts:resolveRound(state, round, inputs, options)`
is **pure**: same inputs → same outputs, no I/O, no clock, no `Math.random`.
It is the only primitive that advances game state — sim CLI, Socket.IO
server, and client EffectPlayer all call this single function.

Inputs:
- `state: ReadonlyArray<PlayerState>` — players in display order, including
  any DEAD players from previous rounds (retained for history; filtered out
  of RPS resolution and never acted on).
- `round: number` — 1-based round counter (used for narration prefixes and
  round-stable tie-line variant selection).
- `inputs.choices: Record<PlayerId, RpsChoice>` — RPS submissions. Stale
  entries for DEAD players are silently ignored.
- `inputs.targets?: Record<PlayerId, PlayerId>` — optional explicit
  actor → loser pairing. If a winner doesn't supply a target (or supplies
  an invalid one), the engine pairs winners with losers in winners-iteration
  order, claiming the first not-yet-claimed loser. Each loser is acted on
  at most once per round.

Outputs:
- `players: PlayerState[]` — fresh array; original is never mutated.
- `effects: Effect[]` — flat ordered choreography. Always starts with
  `ROUND_START`, immediately followed by a single `RPS_REVEAL` carrying
  every alive player's choice for the §H2 reveal hold (atMs=0, the
  whole reveal frame sits inside `PHASE_T_REVEAL=1500ms` before any
  action effect). On a tie round it then emits `TIE_NARRATION` + a
  `NARRATION` mirror for log uniformity; on an action round it emits
  `RPS_RESOLVED`, the full 7 `PHASE_START` boundaries (REVEAL/PREP/
  RUSH/PULL_PANTS/STRIKE/IMPACT/RETURN with `atMs` summing to exactly
  `ROUND_TOTAL_MS`), then per-pairing `ACTION` + `SET_STAGE` +
  `NARRATION`. `GAME_OVER` appends if ≤ 1 player remains alive.
- `narration: string` — human-readable Chinese, one line per pairing,
  joined by `\n`. Drives the BattleLog right rail and the sim CLI's
  grep-able output.
- `rps: RpsResolution` — surfaced for sim CSV / tests; matches what
  `resolveRps()` returned internally.
- `isGameOver: boolean`, `winnerId: PlayerId | null`.

Action selection rule: the *target's pre-round stage* picks the kind:
`ALIVE_CLOTHED → PULL_PANTS`, `ALIVE_PANTS_DOWN → CHOP`, `DEAD → NONE`. So
a player who is already pants-down dies on their next loss — exactly the
v1 spec preserved.

The 7-phase round timeline is computed at module-load from `timing.ts` and
self-validated to sum to `ROUND_TOTAL_MS` (REVEAL=1500 + ACTION=4000) — a
typo in `timing.ts` throws on import rather than producing a desynced
choreography. `PHASE_OFFSETS` (re-exported from the engine) gives callers
the cumulative-offset map without iterating the timeline. REVEAL sits at
atMs=0 ahead of the action sub-segment, so action offsets are
`PHASE_T_REVEAL`-shifted (PREP=1500, RUSH=1800, PULL_PANTS=2400,
STRIKE=3300, IMPACT=3900, RETURN=4700) — downstream consumers
(EffectPlayer, sim CLI, server hold timer) read these offsets so
adding/changing reveal duration ripples through automatically.

Test coverage: `packages/shared/src/game/engine.test.ts` (16 cases) covers
the FINAL_GOAL §A acceptance scenario (4-player ROCK,PAPER,SCISSORS,ROCK →
majority ROCK → 2 PULL_PANTS pairings with phase durations matching
`timing.ts`), tie-path emission, the pants_down → DEAD CHOP transition,
DEAD-player skipping, explicit target overrides, input non-mutation, and a
20-round mulberry32-seeded simulation that verifies state monotonicity
(alive count never increases) and timeline integrity across rounds.

### Narrative module (FINAL_GOAL §F + §C8)

`packages/shared/src/narrative/lines.ts` is the canonical home for the
Chinese-prose surface used everywhere narration is rendered (BattleLog
rows, sim CLI output, server `lastNarration`). Public exports:

- `tieVariants: readonly string[]` — pool of ≥5 colloquial all-equal
  lines. The default tie picker rotates through this pool with a
  `round % pool.length` index so three consecutive ties read as three
  distinct sentences (FINAL_GOAL §C8) while remaining deterministic
  for the headless sim.
- `allSameLine` — single dedicated line for the unanimity case
  (every alive player threw the same shape).
- `emptyLine(round)` — defensive fallback when no alive player
  submitted a choice.
- `pullPantsTemplate(actor, target)` — renders the rhyme's signature
  扒裤衩 sentence: `'A一个箭步上前，扒下了B的裤衩'`.
- `chopTemplate(actor, target)` — renders the chop sentence naming
  the target's `家门` (FINAL_GOAL thematic-honesty rule).
- `dodgeTemplate(actor, target)` — reserved for a future dodge
  mechanic; rounds out the §C8 verb roster (扒/砍/闪/平/死).
- `deathLine(target)` — terminal-elimination flavor; available for
  callers that want to split chop+death narration.
- `defaultNarrator: NarratorShape` — bundles the three templates the
  engine consumes (`tie`, `pullPants`, `chop`). `engine.ts` imports
  this and assigns it to its `Narrator` interface; the structural
  match is asserted at the engine call site.

The `Narrator` interface in `engine.ts` accepts plug-ins, so a richer
streak-aware picker (e.g. v1's `pickTieLine` with `TIE_LINES_STREAK`)
can be passed via `resolveRound(..., { narrator })` without changing
the engine.

Tests: `packages/shared/src/narrative/lines.test.ts` (13 cases) pins
pool size ≥5, the exact `pullPantsTemplate('A','B')` sentence (S-343
acceptance), unanimity-line distinction from the all-equal pool, and
≥3 distinct sentences across 12 consecutive rounds of `defaultNarrator.tie`.
End-to-end: a 200-round seeded sim (`pnpm sim --players 4 --bots
counter,random,iron,mirror --rounds 200 --seed 42`) produces 4 distinct
tie sentences across the all-equal rounds.

## Build / install pipeline

```
pnpm install        ──▶  installs every workspace package's deps + symlinks
                         workspace:* ranges
pnpm -r exec tsc    ──▶  per-package strict typecheck (the iteration-1 gate)
pnpm test           ──▶  Vitest in every package
pnpm sim            ──▶  shorthand for `pnpm --filter @xdyb/server sim`
pnpm dev            ──▶  parallel: server tsx watch + client vite
pnpm build          ──▶  per-package build (server tsup → dist, client vite → dist)
```

## Iteration-1 acceptance evidence

- `pnpm install` from the freshly scaffolded workspace: completed in 4.6s
  (well under the 60s gate, FINAL_GOAL §E1).
- `pnpm -r exec tsc --noEmit`: exits 0 across `@xdyb/shared`, `@xdyb/server`,
  `@xdyb/client` (the iteration-1 acceptance test).

## Client canvas architecture (iteration 6, S-084)

The client is split cleanly between *React chrome* (header, sidebar,
buttons, chips — anything text/2D-DOM) and *PixiJS canvas* (anything
that animates per-frame: clouds, leaves, characters, knife arc).
React owns mount/unmount and a single snapshot of the current room
state; it never re-renders for a per-frame change. PixiJS owns the
animation loop and reads from imperative state set by React.

```
packages/client/src/
  main.tsx                 React root (StrictMode)
  App.tsx                  → <GamePage/>
  palette.ts               hex palette + playerColor() id-hash
  pages/Game.tsx           Game surface — chrome + GameStage host +
                           local engine loop (resolveRound + 3 bots)
  components/
    HandPicker.tsx         Rock/Paper/Scissors (inline SVG icons)
    BattleLog.tsx          right-rail log w/ verb badges + glow + colorized actors
  canvas/
    GameStage.tsx          single Pixi Application; 4 layers
                           (bg / mountains / gameplay / fg);
                           ResizeObserver → renderer.resize +
                           per-layer .resize; per-player diff
                           reconcile (add/remove/update)
    stage/Background.ts    sky bands + sun + drifting clouds
    stage/Mountains.ts     two ridges with snow caps
    stage/Ground.ts        perspective road; exports groundY
    stage/Foreground.ts    lantern + drifting leaves
    stage/House.ts         owner-tinted house + name plaque
    characters/Character.ts chibi rig + IDLE/PREP/RUSH/STRIKE/PULL/
                           SHAME/DEAD/CHEER state machine; persistent
                           setPantsDown() across rounds (FINAL_GOAL §C7)
    RevealGlyphs.ts        §H2 reveal overlay — one drawn-shape gesture
                           badge per alive player (rock/paper/scissors
                           as filled-circle Graphics, NOT emoji, so
                           rendering is platform-independent and CI
                           screenshots match Android Chrome). Shown by
                           EffectPlayer at REVEAL t=0, hidden at
                           PHASE_T_REVEAL=1500ms. Sits on the gameplay
                           layer with zIndex=100 and the layer's
                           sortableChildren=true so reconciled-in
                           characters/houses don't paint over it.
```

Render-loop contract: GameStage adds a single `app.ticker.add(tick)`
that calls `bg.update(dt)`, `fg.update(dt)`, and `character.update(dt)`
for every character. No React state changes per frame. Players are
mirrored from React via the `players: StagePlayer[]` prop, reconciled
in a separate `useEffect([players])` that adds new houses/characters,
updates `setPantsDown` / `setState('DEAD')` for existing ones, and
removes dropped players. `layoutPlayers()` runs `computeSpots(n)` to
implement FINAL_GOAL §C9: 2 → side-by-side, 3 → triangle (apex back),
4 → square (2 back, 2 front), 5–6 → fan / semicircle.

The Game page drives a *local* round loop using shared `resolveRound()`:
collect player choice + 700 ms thinking + bots pick → resolve → for
each `Effect` use `setTimeout(eff.atMs)` to schedule narration / state
flips, with `TIE_NARRATION_HOLD_MS` (2000 ms) for ties and
`ACTION_TOTAL_MS` (4000 ms) for action rounds. This is the Socket.IO
swap point: when the server gains a Room class, the page replaces
its local `resolveRound` call with a `socket.on('round:effects', ...)`
handler that consumes the same Effect[] shape.

Visual fidelity choices:
- *No external sprite atlases.* Every character / house / cloud /
  mountain / lantern is drawn from PixiJS Graphics primitives in
  TypeScript. Side benefit: zero asset-pipeline cost, deterministic
  colors via `playerColor(id)`.
- *No emoji in the chrome layer.* All glyphs (rock/paper/scissors,
  speaker, pants-down indicator) are inline SVG so they render
  identically across browsers and headless test runners.
- *BattleLog is a true sidebar*, not a floating overlay. The
  `<GameStage>` host, header, and footer are sized
  `right: min(30vw, 360px)` so the canvas never paints under the
  log. (An earlier overlay using `backdrop-filter: blur(6px)`
  bled outside its bounds in headless chrome.)

PixiJS v8 + React 18 StrictMode notes:
- `app.init({ resizeTo: host })` is *not* used; StrictMode's
  double-mount confused the resize plugin's binding and threw
  `this._cancelResize is not a function` during cleanup. Instead,
  GameStage passes explicit `width/height` and runs renderer.resize()
  manually from the ResizeObserver. The cleanup tracks `cancelled`
  and `initialized` flags so a tear-down before `app.init` resolves
  doesn't double-destroy.


## Client networking (iteration 29, S-324)

**Wire shape (mirrors the server's vocabulary):**

```
client → server: room:create {nickname}
                 room:join   {code, nickname}
                 room:leave
                 room:addBot
                 room:start
                 room:choice {choice}
                 room:rematch

server → client: room:created  {code, snapshot}
                 room:joined   {code, snapshot}
                 room:snapshot RoomSnapshot
                 room:effects  {round, effects[], narration, isGameOver, winnerId}
                 room:error    {code, message}
```

`packages/client/src/socket.ts` is the only file that touches
`socket.io-client`. Every inbound event fans into the Zustand
`gameStore` so React components subscribe to *state*, never to
sockets directly. The store holds `{connected, error, code,
snapshot, pendingRounds[]}` — no animation/sprite state, that lives
in Pixi per FINAL_GOAL §A.

**Round-drain pattern (MultiGame.tsx):** each `room:effects` payload
is appended to `pendingRounds`. A `useEffect` (guarded by a
`drainingRef` to prevent re-entry under StrictMode's double-mount)
loops while the queue is non-empty: pop the head, await
`EffectPlayer.play(effects, players, {onNarration})`, push the
narration rows to the BattleLog, call `stage.reset(playerIds)`,
then `shiftRound()`. This keeps animation timing canonical
(`packages/shared/src/game/timing.ts`) and identical between solo
and multi paths — the only difference is who supplies the effects.

**Routing:** App.tsx is a 4-state conditional render keyed off
`{solo, code, snapshot.phase}`:
- `solo === true` → `<GamePage>` (legacy single-player canvas)
- `!code` → `<LandingPage>` (nickname + create/join)
- `snapshot.phase === 'LOBBY'` → `<LobbyPage>` (player list + 开战)
- otherwise → `<MultiGamePage>` (PLAYING or ENDED)

No react-router; the cold-load surface is zero-config and the
Lobby→MultiGame transition fires automatically when the host clicks
开战 (server flips `phase=PLAYING`, snapshot lands in the store,
App re-renders).

**Smoke proof:** `node scripts/smoke-multiplayer.mjs` boots the real
server (via tsx) and runs two `socket.io-client` sockets through the
full create→join→start→submit handshake. Asserts (a) the 4-char
code propagates, (b) host and guest receive byte-identical
`Effect[]` timelines on resolve, (c) the lone surviving player is
promoted to host on disconnect.

## Client bundle strategy (§E3, S-520)

The §E3 ship gate is **all gzipped JS chunks loaded by `/game` ≤ 300
KB**. PixiJS 8 alone is ~160 KB gzipped — bigger than every other
dependency combined — so the chunk graph is laid out so PixiJS pays
its cost once, in a long-lived vendor chunk, not in every app-code
update.

**Three-layer split (`packages/client/vite.config.ts` →
`build.rollupOptions.output.manualChunks`):**

1. **`pixi-vendor`** (~160 KB gzipped): every module under
   `node_modules/pixi.js/` and `node_modules/@pixi/*`. The whole
   WebGL renderer lands here. Cached aggressively by hash; app-code
   changes never invalidate it.
2. **`react-vendor`** (~45 KB gzipped): `react`, `react-dom`,
   `scheduler`. The landing route is the only place that needs
   React eagerly, so this chunk preloads with the entry HTML.
3. **`index` (entry, ~21 KB gzipped):** the App shell + Landing
   page + Zustand store + Socket.IO client wrapper. Pixi is NOT
   in this graph — Game/MultiGame are behind `React.lazy`.

**Route-level lazy split (`App.tsx`):** `GamePage` and
`MultiGamePage` are wrapped in `lazy(() => import(…))`. Their
chunks (`Game.js`, `MultiGame.js`, `BattleLog.js`) load only when
the user actually enters a game (clicks 单机练习 or the host
clicks 开战). Landing-only first paint ships ~66 KB gzipped
(index + react-vendor); entering a game pulls in pixi-vendor +
the route chunk on demand.

**The `loadSpriteWithFallback` static-import note:** earlier
S-516 used `await import('pixi.js')` inside `defaultLoad` so the
file could be imported under jsdom without dragging Pixi's WebGL
stubs into tests. That dynamic import was a no-op for chunking
(every other canvas module already imports pixi statically) and
made Rollup print a "dynamically imported but also statically
imported" warning. S-520 reverts it to a static
`import { Assets } from 'pixi.js'` — pixi-vendor manualChunk
catches it; tests still work because the vitest config + the
existing test fixtures inject a fake `load` dep before the real
loader runs.

**Acceptance numbers (S-520, measured):**
- Landing first paint: index + react-vendor ≈ **66 KB gzipped**.
- /game route (solo or multi): index + react-vendor + pixi-vendor +
  Game/MultiGame + BattleLog ≈ **255 KB gzipped** (under 300 KB).
- No "dynamic import will not move module into another chunk"
  warning. No "chunks larger than 500 kB" warning.
