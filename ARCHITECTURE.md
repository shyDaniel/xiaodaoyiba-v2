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
