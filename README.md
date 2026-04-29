# 小刀一把 (xiaodaoyiba) v2

> 小刀一把，来到你家，扒你裤衩，直接咔嚓！

A 2-6 player web RPS game where winners rush to a loser's house, pull their
pants down, and chop. v2 rebuilds v1's renderer on **PixiJS canvas** for
Steam-indie aesthetic, fixes the multi-player RPS engine so games actually
resolve (no more "always tie"), and ships a **headless `pnpm sim` CLI** so AI
agents can iterate game logic without a browser.

This repository is currently being scaffolded. See
[`FINAL_GOAL.md`](./FINAL_GOAL.md) for the full spec and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system shape.

## Workspace layout

```
xiaodaoyiba-v2/
├── packages/
│   ├── shared/    Pure game logic (timing, RPS, engine, bots, narrative)
│   ├── server/    Socket.IO server + headless `pnpm sim` CLI
│   └── client/    Vite + React 18.3 + PixiJS 8 game client
├── tsconfig.base.json
├── pnpm-workspace.yaml
└── package.json   workspace root
```

## Install / dev / test / sim

Requires **Node ≥ 20** and **pnpm ≥ 9**.

```bash
pnpm install              # one-time install (≤ 60s on a clean machine)
pnpm typecheck            # tsc --noEmit across every package
pnpm test                 # Vitest across every package
pnpm dev                  # server :3000  +  client :5173  (concurrent, hot-reload)
pnpm build                # server dist + client dist
pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 50 --seed 42
```

`pnpm sim` is the canonical AI-debugging tool: no Socket.IO, no browser, no
server, just deterministic round-by-round logs. See
[`packages/server/README.md`](./packages/server/README.md).

## Status

Iteration 1 — workspace bootstrapped (this commit). Subsequent iterations
fill in shared (timing/rps/engine/bots), server (rooms + sim runner), and
client (PixiJS canvas + BattleLog). Track progress in
[`WORKLOG.md`](./WORKLOG.md).
