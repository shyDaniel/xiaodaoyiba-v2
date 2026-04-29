# FINAL_GOAL.md — xiaodaoyiba v2

## What this project is

小刀一把 (xiaodaoyiba) is a casual web multiplayer game based on the Chinese
nursery rhyme **"小刀一把，来到你家，扒你裤衩，直接咔嚓！"** (one little knife,
come to your house, pull down your pants, chop!). 2-6 players in a room throw
rock-paper-scissors; winners pick a loser to act on (rush across the stage,
pull their pants down, then chop their house). Eliminations until one player
remains.

**v2 reason for existing:** v1 shipped at https://github.com/shyDaniel/xiaodaoyiba
with working game flow + viral 扒裤衩 animation, but two structural problems
make iteration painful:

1. **The renderer is at its ceiling.** v1 is HTML/CSS pixel-art at 32×32
   native, scaled 2-3× via `image-rendering: pixelated`. Final rendered
   characters are ~96px viewport size — reads as "1960s era" / "early
   mobile prototype." Modern Steam indie games (Stardew Valley, Spiritfarer,
   Hyper Light Drifter, Cuphead, Hades) feel different not because they're
   higher-fidelity but because they invest in *render-layer juice*: real
   particle systems, multi-layer parallax, camera shake, lighting, blend
   modes. v1's DOM-based pipeline cannot reach that bar by iteration.

2. **Multi-bot games are perceived as "always tie."** Root cause is two
   compounding bugs in v1:
   - `packages/shared/src/game/rps.ts:27-29` resolves N≥3 as tie when
     `unique.size !== 2` (so 1 OR 3 distinct shapes = tie).
   - `Room.ts:398` seeds every bot with the same shared `Math.random`
     and uses the same default `counterBot` strategy — so 3+ bots
     converge on the same throw, the human becomes the only outlier,
     human always loses, and player perceives "all ties."
   The fix needs *both*: smarter RPS resolution for N≥3 (majority wins;
   if no majority, distinct-shape players advance) AND diversified bot
   strategies with per-bot seeded RNG.

v2 also adds a **headless game mode** as a Day-1 requirement so AI agents
(including autopilot) can iterate server-side fast without spinning up
Chrome / Playwright / a dev server. The pure resolveRound() function
already exists in v1; v2 wraps it in a CLI sim runner and hoists timing
constants into shared so server, CLI, and UI all read the same numbers.

## Tech stack (deliberate, not negotiable)

- **pnpm workspaces.** Three packages: `shared`, `server`, `client`.
- **TypeScript strict mode** everywhere. No `any` escape hatches in committed
  code.
- **Vitest** for unit tests, single test runner across packages.
- **Vite** for the client bundler. **tsup** or `tsc` for server.
- **Socket.IO** client + server for room state sync.
- **PixiJS 8.x** for the game stage rendering (canvas/WebGL2). React renders
  ONLY the surrounding chrome (lobby, BattleLog right rail, settings,
  scoreboard). The Game stage is one `<canvas>` mounted by a React
  component that hands a PixiJS Application instance everything it needs.
- **React 18.3** for non-canvas UI chrome only.
- **Tailwind CSS** for non-canvas UI chrome only.
- **Zustand** for client state (room snapshot, player list, mute toggle).
  Animation/sprite frame state lives in PixiJS, NOT in Zustand — this is
  the v1 entanglement we are explicitly fixing.
- **Node ≥ 20** for the server.

## Repository structure

```
xiaodaoyiba-v2/
├── package.json                        (pnpm workspace root)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── ARCHITECTURE.md
├── WORKLOG.md
├── FINAL_GOAL.md                       (this file)
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── game/
│   │   │   │   ├── timing.ts           (single source of truth for animation durations)
│   │   │   │   ├── rps.ts              (multi-player RPS resolution; fixed for N>=3)
│   │   │   │   ├── engine.ts           (pure resolveRound function)
│   │   │   │   ├── bots/
│   │   │   │   │   ├── index.ts        (registry + diversifier)
│   │   │   │   │   ├── counter.ts
│   │   │   │   │   ├── random.ts
│   │   │   │   │   ├── iron.ts
│   │   │   │   │   ├── mirror.ts
│   │   │   │   │   └── seedRng.ts      (mulberry32 or splitmix32)
│   │   │   │   ├── effects.ts          (Effect[] choreography protocol)
│   │   │   │   └── types.ts
│   │   │   └── narrative/
│   │   │       └── lines.ts            (tie variant pool, action narration)
│   │   └── tsconfig.json
│   ├── server/
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts                (Socket.IO server entry)
│   │   │   ├── rooms/Room.ts
│   │   │   ├── matchmaking.ts
│   │   │   └── sim.ts                  (CLI sim entry — the headless mode)
│   │   └── tsconfig.json
│   └── client/
│       ├── package.json
│       ├── index.html
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── Landing.tsx
│       │   │   ├── Lobby.tsx
│       │   │   └── Game.tsx            (mounts <GameStage> + BattleLog + nameplates)
│       │   ├── canvas/
│       │   │   ├── GameStage.tsx       (PixiJS Application root)
│       │   │   ├── stage/
│       │   │   │   ├── Background.ts   (parallax sky / mountains / clouds)
│       │   │   │   ├── Ground.ts       (perspective tiles)
│       │   │   │   ├── House.ts        (house sprite + roof tinting)
│       │   │   │   └── Foreground.ts   (lanterns / leaves)
│       │   │   ├── characters/
│       │   │   │   ├── Character.ts    (PixiJS AnimatedSprite + state machine)
│       │   │   │   └── Pants.ts        (independent ankle-briefs sprite layer)
│       │   │   ├── particles/
│       │   │   │   ├── DustEmitter.ts
│       │   │   │   ├── ClothEmitter.ts
│       │   │   │   ├── WoodChipEmitter.ts
│       │   │   │   └── ConfettiEmitter.ts
│       │   │   ├── camera/
│       │   │   │   ├── Camera.ts       (root container transform)
│       │   │   │   └── ScreenShake.ts
│       │   │   └── EffectPlayer.ts     (consumes Effect[] from server, dispatches canvas calls)
│       │   ├── components/
│       │   │   ├── BattleLog.tsx       (right-rail panel, color-coded verbs)
│       │   │   ├── HandPicker.tsx      (rock/paper/scissors button row)
│       │   │   └── PlayerCard.tsx      (lobby player card)
│       │   ├── audio/
│       │   │   ├── zzfx.ts             (port from v1 verbatim)
│       │   │   ├── bgm.ts              (port from v1)
│       │   │   └── presets.ts          (named SFX exports)
│       │   ├── store/
│       │   │   └── gameStore.ts        (room state ONLY; no animation state)
│       │   ├── palette.ts              (extended palette: 16 base + light/dark variants)
│       │   ├── socket.ts               (Socket.IO client wrapper)
│       │   └── index.css               (Tailwind imports, font, base reset)
│       └── tsconfig.json
└── scripts/
    ├── gen-sprites.mjs                 (procedural sprite generator → PNG/spritesheet)
    └── smoke-headless.mjs              (E2E sim verifying acceptance numbers)
```

## Acceptance criteria (this is what eval / judge check)

### A. Game logic correctness (server-only, no UI needed)

**A1. Headless sim CLI exists and is fast.** `pnpm sim --players N --bots
COMMA_LIST --rounds R --seed S` runs without starting a server, without
spawning a browser, no Socket.IO, no React. Output is round-by-round
JSONL or CSV (one row per round) with columns: `round, throws[], winners[],
losers[], action, narration`. 50 rounds × 4 players completes in **< 2
seconds** wall-clock.

**A2. Multi-player RPS resolves correctly.** A 50-game simulation with
4 players (1 human-replaced-by-random-strategy + 3 mixed bots:
`counter, random, iron`) produces:
- tie rate < 30%
- no single player wins > 60%
- average game length 5-15 rounds
- zero infinite loops (game always terminates)
- `unique.size === 3` (rock+paper+scissors all thrown) is **handled**, not
  treated as automatic tie. Recommended rule: majority wins, or if no
  majority, the players with the unique-shape advance; document the
  chosen rule clearly in `rps.ts` + `ARCHITECTURE.md`.

**A3. Bot strategies are diversified by default.** When the user clicks
"加一个机器人" in the lobby, the server picks the bot's strategy by
round-robin (`counter → random → iron → mirror → repeat`) or by hash of
botId — but NOT always the same default. Two bots in the same room
must have different strategies whenever ≥ 2 strategies are registered.

**A4. Each bot has its own seeded RNG.** `seedRng(seed: number) → () => number`
produces a deterministic stream. `assignBotRng(botId)` derives the seed
from `botId + roomId + (optional --seed CLI flag)`. Two bots with the
same strategy but different seeds produce independent throws. The CLI
sim's `--seed` makes a full run reproducible.

**A5. Single source of truth for timing.** `packages/shared/src/game/timing.ts`
exports the canonical animation durations. Server, sim, and client all
import from this file. No hard-coded duplicates of `4000`, `900`, `2400`
anywhere else in the codebase. Constants:
```ts
export const PHASE_T_PREP = 300;
export const PHASE_T_RUSH = 600;       // 300 → 900
export const PHASE_T_PULL_PANTS = 900; // 900 → 1800
export const PHASE_T_STRIKE = 600;     // 1800 → 2400
export const PHASE_T_IMPACT = 800;     // 2400 → 3200
export const PHASE_T_RETURN = 800;     // 3200 → 4000
export const ACTION_TOTAL_MS = 4000;
export const TIE_NARRATION_HOLD_MS = 2000;
export const SHAME_FRAME_HOLD_MS = 400;
```

### B. Headless / dev-velocity force multipliers

**B1.** `pnpm test` (run from repo root) executes all package tests in
**< 5 seconds total**.

**B2.** `pnpm sim` is the canonical AI-debugging tool. Output is grep-able:
```
$ pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 5 --seed 42
round=1 throws=[ROCK,PAPER,SCISSORS,ROCK] winners=[1] losers=[0,3] action=PULL_PANTS target=0 narration="小红一把扒下你的裤衩"
round=2 throws=[PAPER,PAPER,ROCK,SCISSORS] winners=[2] losers=[0,1] action=CHOP target=1 narration="..."
...
=== summary ===
games=1 rounds=5 ties=1 winner=2 duration_ms=87
```

**B3.** `pnpm dev` runs server (port 3000) + client (Vite, port 5173)
concurrently with hot reload. Editing a file in `packages/shared/` triggers
re-typecheck + restart on both server and client.

**B4.** Headless sim ↔ live game **timing match**: `sim` records each
phase's duration; the live server uses the same `timing.ts` constants.
There is one canonical timeline, not two.

### C. UI / Steam-quality (eval verifies via Playwright MCP)

**C1. Canvas-based renderer.** The Game stage is a single `<canvas>`
controlled by a PixiJS Application. React components mount around it
(BattleLog, HandPicker, scoreboard, lobby), but no React component
re-renders on sprite frame ticks. `image-rendering: pixelated` does NOT
appear anywhere in CSS — the v1 hack is gone.

**C2. Native sprite resolution.** Characters are ≥ 128×128 native pixels
in their spritesheets. Houses are ≥ 256×256. Particles are ≥ 16×16.
Sprite art may be procedurally generated (e.g. by a `scripts/gen-sprites.mjs`
that draws into an `OffscreenCanvas` and exports PNGs) — autopilot
chooses the generation method but the rendered output must be detailed
enough that a 256-px viewport character has visible eyes, mouth, hand
detail, and clothing folds.

**C3. Particle systems.** All four emitters present and visibly active:
- **Dust** during rush (gritty puffs from feet, ≥ 8 particles per step)
- **Cloth** on PULL_PANTS (≥ 12 small fabric scraps, falling with gravity)
- **Wood chips** on CHOP (≥ 12 chips with rotation + arc trajectory)
- **Confetti** on game victory (≥ 32 colored squares, swirling fall,
  ≥ 3 colors)

Each emitter uses physics (velocity, gravity, drag, fade-out alpha) — not
just CSS keyframes.

**C4. Camera + screen shake.** The PixiJS root container has a Camera
node with translate/scale state. Screen shake is a Camera transform
(NOT a CSS class on a div):
- **Subtle Y-shake** on impact (8 px magnitude, 80 ms)
- **Larger X-shake** on KO / final death (16 px, 200 ms)
- **Subtle zoom-in** on the active attacker during PULL_PANTS (1.0 → 1.1
  scale over 600 ms, ease-out)

**C5. Parallax stage.** ≥ 4 distinct layers:
1. Sky + slow drifting clouds (parallax 10%)
2. Far mountains + sun/moon (parallax 30%)
3. Mid-ground props (houses, road tiles, lanterns) (parallax 100% — the
   gameplay layer)
4. Foreground decor (overhanging tree leaves, foreground lanterns,
   particles) (parallax 130%)

When the camera shakes or zooms, layers move at different rates,
revealing depth.

**C6. The "send to a friend" test.** When eval takes a mid-action
screenshot (any round, any phase), it must look like a 2024 indie game
screenshot, not a 2010 mobile prototype. **Eval's mental reference**:
Stardew Valley, Spiritfarer, Hyper Light Drifter, Cuphead, Slay the
Spire, Hades, Cookie Clicker, Townscaper, Vampire Survivors. If our
screenshot looks amateur next to those, eval returns `passed: false`.

**C7. Visible 扒裤衩 phase, persistent shame.** This is the v1 spec
preserved verbatim because it's the IP of the game:
- During PULL_PANTS phase (900 ms), the victim's pants sprite (red ankle
  briefs underneath, normal pants on top) animates: top pants slides
  from waist (y0) to ankle (y1), revealing the red briefs.
- The shame frame (victim showing ⚆_⚆ expression + sweat drop) holds
  ≥ 400 ms.
- **Persistence**: after PULL_PANTS, while `player.stage === 'ALIVE_PANTS_DOWN'`,
  the character continues to render with red briefs at ankles in EVERY
  subsequent round, in EVERY phase (CHOOSING / RPS / ACTION / waiting),
  until the player dies or wins. This is non-negotiable; the v1 eval
  flagged this exact regression.
- The BattleLog message "永久掉在脚踝上" (forever at the ankles) must
  match what the sprite shows.

**C8. BattleLog right-rail panel.** Same as v1 (which was great):
- Right rail, fixed-position panel, ≥ 30vh on desktop, full-width on
  mobile.
- Each entry has timestamp prefix `R{N}.{phase}` (e.g. `R2.pull_pants`).
- Action verbs are color-coded badges: 扒 (yellow), 砍 (red), 闪 (cyan),
  平 (gray), 死 (purple).
- Player names are color-coded; each player gets a stable color across
  the game (hash from playerId).
- New entries fade in + glow yellow for 800 ms.
- Scrollable history.
- Tie narration uses a variant pool of ≥ 5 distinct lines so 3
  consecutive ties read as 3 different sentences.

**C9. Multiple-player layouts.** 2 players: side-by-side. 3 players:
triangle (apex top, base bottom). 4 players: square corners. 5-6
players: fan/semicircle. Houses do NOT line up flat in any layout. Each
player's house has a deterministic visual identity (roof color, door
color, name plaque) derived from `playerId` hash.

### D. Audio

**D1.** ZzFX SFX presets ported from v1 verbatim, exposed as named
exports: `tap, reveal, pull, chop, dodge, thud, victory, defeat,
roundStart`. Triggered by EffectPlayer.

**D2.** ZzFXM BGM ported. Three variants: lobby (calm pentatonic),
battle (slightly tense, same key), victory (uplifting flourish).
Auto-cross-fade between variants on phase change.

**D3.** Mute toggle in the corner of the game stage. State persisted
to localStorage.

### E. Build + dev workflow

**E1.** `pnpm install` from repo root succeeds in ≤ 60 s on a clean
machine (best-effort; cached should be ≤ 10 s).

**E2.** `pnpm test` runs all unit tests across packages, exits 0, < 5 s
total.

**E3.** `pnpm build` produces:
- Server bundle at `packages/server/dist/`
- Client static bundle at `packages/client/dist/` ≤ **300 KB gzipped**
  (the increase from v1's 80 KB is acceptable because we now have
  PixiJS + spritesheets — but verify the *code* portion is still
  reasonable; sprites should be lazy-loaded if possible).

**E4.** `pnpm sim` works from a fresh clone after `pnpm install` only
(no separate build step needed; runs via `tsx` or after a one-time
build).

**E5.** GitHub Actions CI: on every push, run `pnpm install` (cached) +
`pnpm test` + `pnpm build`. Green gate to merge. Use `pnpm/action-setup`
+ `actions/setup-node@v4` with Node 20.

### F. Documentation

**F1.** `README.md` at repo root: 1-paragraph pitch, install/dev/test/
sim commands, screenshot, link to architecture doc.

**F2.** `ARCHITECTURE.md`: high-level diagram of shared/server/client
interaction, the Effect[] protocol, the 5-phase action timeline
(referencing `timing.ts` numbers), the sim CLI shape, and a "why
PixiJS / why headless mode / why fixed RPS" rationale.

**F3.** `WORKLOG.md`: append-only iteration log, latest at bottom.

**F4.** Per-package `README.md` for `shared/`, `server/`, `client/`
documenting their public API.

### G. Out of scope (do NOT flag these as outstanding)

- Fly.io deploy (paid account required; user does this manually)
- Two-device cross-network real-radio test (requires physical hardware)
- Account system / sign-up / login
- ELO / leaderboards / seasons
- Observation mode (cross-room spectating)
- In-app purchases / cosmetics
- Voice chat
- Native mobile app (PWA optimizations only)

If any of these surface as outstanding in a verdict, mark them blocked
in the plan ledger with reason "out of scope per FINAL_GOAL §G."

## Reuse pointers (concrete v1 paths the worker can read or `cp`)

The v1 codebase lives at `/home/hanyu/projects/xiaodaoyiba/`. Worker
should READ these files to inform v2 implementation but rebuild fresh
in v2 (no `cp` of TS source — only verbatim assets):

- `xiaodaoyiba/packages/client/src/audio/zzfx.ts` — copy verbatim
- `xiaodaoyiba/packages/client/src/audio/bgm.ts` — copy, possibly extend
- `xiaodaoyiba/packages/client/src/render/palette.ts` — read to extract base 16
  hex values, then extend in v2's `palette.ts`
- `xiaodaoyiba/packages/shared/src/game/engine.ts` — read for the
  resolveRound() shape; rewrite in v2 with timing-constants imported from
  shared
- `xiaodaoyiba/packages/client/src/store/gameStore.ts:24-38` — read the
  v1 timing constants here and migrate them to `shared/src/game/timing.ts`
- `xiaodaoyiba/packages/server/src/narrative/lines.ts` — read the tie
  variant pool, port to v2's `shared/src/narrative/lines.ts`
- `xiaodaoyiba/FINAL_GOAL.md` — read v3/v4 sections for the choreography
  spec. v2 inherits the spec; the *spec is good*, only the *implementation*
  changes.

DO NOT copy `xiaodaoyiba/packages/client/src/render/`, `frames.ts`,
`PixelCharacter.tsx`, `BigHouseSprite.tsx`, `EffectPlayer.tsx`,
`HouseZone.tsx`, or any of the DOM-based render components. Those are
the layer being torn out.

## Notes on the autopilot loop driving this build

Autopilot is at `/home/hanyu/projects/agent-autopilot` and is npm-linked.
Skills the worker / judge / eval will use:

- `judge` (uncompromising shipping reviewer)
- `eval` (adversarial second-pass critic — can override done indefinitely)
- `orchestrate` (decides next skill: work / reframe / evolve / exit-stuck)
- `work` (implements one chunk per iteration; max 30 turns)
- `evolve` (edits autopilot itself if the orchestrator detects a tool-side gap)
- `report` (post-run structured graph of what happened)

Refinement budget: 5. The orchestrator will trigger `evolve` if the
worker / judge / eval keep spinning on the same blind spot. This is
expected and welcome.

## Definition of Done

The judge returns `done: true` AND eval returns `passed: true` AND the
following manual / sim checks pass:

```bash
# Headless gate
pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 50 --seed 42
# → exits 0, prints summary, ties < 30%, no single bot wins > 60%

# Test gate
pnpm test
# → all green

# Build gate
pnpm build
# → server + client bundles, client ≤ 300 KB gzipped

# UI gate (eval-driven via Playwright MCP)
pnpm dev
# → eval drives to /game, throws fists, takes screenshots,
#   compares mentally to Stardew/Spiritfarer/Hades, returns passed:true
```

When done, autopilot writes `.autopilot/FINAL_REPORT.md` summarizing
iterations, refinements, eval overrules, and commits landed. The user
plays a 60-second session and decides whether to archive v1.
