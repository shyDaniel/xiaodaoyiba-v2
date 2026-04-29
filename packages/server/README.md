# @xdyb/server

Socket.IO room server **and** the headless `pnpm sim` CLI. Both consume the
same `@xdyb/shared` engine + timing constants so live games and offline
simulations stay in lock-step (FINAL_GOAL §B4).

## Public surface (target)

| Module               | Purpose                                                  |
| -------------------- | -------------------------------------------------------- |
| `src/index.ts`       | Socket.IO entry on `:3000`                               |
| `src/rooms/Room.ts`  | Per-room game state machine + Effect[] choreographer     |
| `src/matchmaking.ts` | Lobby join / leave / bot-add diversification             |
| `src/sim.ts`         | Headless CLI runner — no Socket.IO, no browser           |

## Scripts

- `pnpm dev` — `tsx watch src/index.ts`
- `pnpm sim` — `tsx src/sim.ts` (forwards CLI args)
- `pnpm build` — `tsup` to `dist/`
- `pnpm test` — Vitest
