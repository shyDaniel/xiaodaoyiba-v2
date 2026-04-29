# 小刀一把 (xiaodaoyiba) v2

> 小刀一把，来到你家，扒你裤衩，直接咔嚓！

A 2-6 player web RPS game where winners rush to a loser's house, pull their
pants down, and chop. v2 rebuilds v1's renderer on **PixiJS canvas** for
Steam-indie aesthetic, fixes the multi-player RPS engine so games actually
resolve (no more "always tie"), and ships a **headless `pnpm sim` CLI** so AI
agents can iterate game logic without a browser.

See [`FINAL_GOAL.md`](./FINAL_GOAL.md) for the full spec and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for the system shape.

## Workspace layout

```
xiaodaoyiba-v2/
├── packages/
│   ├── shared/    Pure game logic (timing, RPS, engine, bots, narrative)
│   ├── server/    Socket.IO server + headless `pnpm sim` CLI
│   └── client/    Vite + React 18.3 + PixiJS 8 game client
├── scripts/
│   └── smoke-headless.mjs   server-boot + sim CI smoke
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
pnpm smoke                # boot server + sim end-to-end (CI gate)
```

`pnpm sim` is the canonical AI-debugging tool: no Socket.IO, no browser, no
server, just deterministic round-by-round logs. With `--rounds ≥ 20` it runs
under `--strict` by default and **exits 1** on §A2 budget breaches
(tie_rate ≥ 30% over 50 rounds, or any bot wins > 60%). Pass `--no-strict` to
downgrade breaches to stderr warnings. See
[`packages/server/README.md`](./packages/server/README.md).

`pnpm smoke` boots the real `@xdyb/server` on a random port, asserts
`/healthz` answers with the shared-package version, then runs the canonical
seed-42 sim — the smallest CI invocation that proves both halves of the
game (matchmaking + round engine) work end-to-end.

## Status

The shared engine, server (matchmaking + rooms over Socket.IO), and headless
sim are all live. The client canvas + lobby + battle-log are wired into
`packages/client/`. Track per-iteration progress in
[`WORKLOG.md`](./WORKLOG.md).
