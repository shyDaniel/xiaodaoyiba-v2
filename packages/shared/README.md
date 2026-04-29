# @xdyb/shared

Pure, side-effect-free game logic shared between the server, client, and the
headless sim CLI. **Single source of truth for animation timing, RPS rules,
bot strategies, and narrative line pools.**

## Public surface (target — populated in subsequent iterations)

| Module                       | Purpose                                                |
| ---------------------------- | ------------------------------------------------------ |
| `@xdyb/shared/game/timing`   | Phase durations (PHASE_T_PREP, PHASE_T_RUSH, …)        |
| `@xdyb/shared/game/rps`      | Multi-player RPS resolution (N≥3 fixed)                |
| `@xdyb/shared/game/engine`   | Pure `resolveRound(throws, bots, rng)` function        |
| `@xdyb/shared/game/bots`     | Strategy registry + diversifier + seedRng              |
| `@xdyb/shared/narrative`    | Tie / action narration line pools                      |

This package MUST stay free of `socket.io`, `pixi.js`, `react`, DOM, and
Node-specific imports — it is consumed by the headless sim, the Socket.IO
server, AND the browser client.

## Scripts

- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest unit tests
