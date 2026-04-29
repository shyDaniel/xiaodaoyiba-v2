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
  `ROUND_START`; on a tie round emits `TIE_NARRATION` + a `NARRATION` mirror
  for log uniformity; on an action round emits `RPS_RESOLVED`, the full 6
  `PHASE_START` boundaries (PREP/RUSH/PULL_PANTS/STRIKE/IMPACT/RETURN with
  `atMs` summing to exactly `ACTION_TOTAL_MS`), then per-pairing `ACTION` +
  `SET_STAGE` + `NARRATION`. `GAME_OVER` appends if ≤ 1 player remains alive.
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

The 5-phase action timeline is computed at module-load from `timing.ts` and
self-validated to sum to `ACTION_TOTAL_MS` — a typo in `timing.ts` throws
on import rather than producing a desynced choreography. `PHASE_OFFSETS`
(re-exported from the engine) gives callers the cumulative-offset map
without iterating the timeline.

Test coverage: `packages/shared/src/game/engine.test.ts` (16 cases) covers
the FINAL_GOAL §A acceptance scenario (4-player ROCK,PAPER,SCISSORS,ROCK →
majority ROCK → 2 PULL_PANTS pairings with phase durations matching
`timing.ts`), tie-path emission, the pants_down → DEAD CHOP transition,
DEAD-player skipping, explicit target overrides, input non-mutation, and a
20-round mulberry32-seeded simulation that verifies state monotonicity
(alive count never increases) and timeline integrity across rounds.

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
