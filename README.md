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

## Drop in your own art

The procedural Character + House sprites (drawn entirely with PixiJS Graphics)
are the production fallback — the game is fully playable without any PNG
assets. But if you've drawn (or AI-generated) art for a specific player slot,
you can drop a PNG into `assets/sprites/` and the loader picks it up on the
next page refresh — **no build step required**.

### Naming convention (FINAL_GOAL §K6)

```
assets/sprites/characters/p<slot>-idle-0.png   e.g. p0-idle-0.png  (96 × 128)
assets/sprites/houses/p<slot>-house.png        e.g. p0-house.png   (192 × 168)
```

`<slot>` is `p0`..`p5` — the player's index in the room's turn order.

### Anchor convention

| Role       | Anchor          | What that means                                         |
| ---------- | --------------- | ------------------------------------------------------- |
| character  | bottom-center   | the character's **feet** sit on the bottom edge of the PNG canvas |
| house      | bottom-center   | the building's **ground line** (where the wall meets the iso ground tile) sits on the bottom edge |

Both use Pixi `anchor.set(0.5, 1.0)`. The loader rescales each sprite to
match the procedural rig's display height (96 px for characters, the
layout-driven house height for buildings), so an off-spec aspect ratio
just gets letterboxed; off-spec anchor placement clips at the wrong line.

### Workflow

1. **Bootstrap reference placeholders** (optional — gives you known-good
   filenames to overwrite):
   ```bash
   node scripts/gen-sprites.mjs        # writes 12 placeholder PNGs (p0..p5 × characters/houses)
   node scripts/gen-sprites.mjs --force # overwrite existing files
   ```
2. **Replace** the placeholder PNG at e.g.
   `assets/sprites/characters/p0-idle-0.png` with your own art.
3. `pnpm dev` — refresh the browser. The procedural rig for that slot is
   automatically replaced by your PNG.
4. **Missing PNG ⇒ procedural rig stays.** No errors, no console noise — the
   loader silently falls back to the built-in rig. So you can ship art
   incrementally; players you haven't drawn for keep the procedural look.

### How the loader works

Vite's `publicDir` is pointed at the repo-root `assets/` directory, so a PNG
at `assets/sprites/characters/p0-idle-0.png` is served at
`/sprites/characters/p0-idle-0.png` in dev AND copied verbatim to
`packages/client/dist/sprites/...` on `pnpm build`.

`packages/client/src/canvas/loadSpriteWithFallback.ts` HEAD-probes the URL
before calling Pixi's `Assets.load`, so missing files don't trigger Pixi's
internal error logger — the procedural rig just stays in charge.

## Status

The shared engine, server (matchmaking + rooms over Socket.IO), and headless
sim are all live. The client canvas + lobby + battle-log are wired into
`packages/client/`. Track per-iteration progress in
[`WORKLOG.md`](./WORKLOG.md).
