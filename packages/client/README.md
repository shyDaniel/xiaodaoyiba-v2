# @xdyb/client

Vite + React 18.3 + PixiJS 8 client. **React renders the UI chrome only**
(landing, lobby, BattleLog right rail, scoreboard). The Game stage is one
`<canvas>` driven by a single PixiJS `Application` — animation / sprite frame
state lives in PixiJS, not in Zustand. This separation is the v1
entanglement we are explicitly fixing (FINAL_GOAL §C1).

## Layout (target)

| Path                            | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `src/main.tsx`                  | Vite entry; mounts `<App>` into `#root`          |
| `src/App.tsx`                   | React Router (Landing → Lobby → Game)            |
| `src/canvas/GameStage.tsx`      | Mounts the single PixiJS `Application`           |
| `src/canvas/stage/`             | Background / Ground / House / Foreground layers  |
| `src/canvas/characters/`        | Character + Pants sprites (state machines)       |
| `src/canvas/particles/`         | Dust / Cloth / WoodChip / Confetti emitters      |
| `src/canvas/camera/`            | Camera + ScreenShake transforms                  |
| `src/canvas/EffectPlayer.ts`    | Consumes `Effect[]` from the server               |
| `src/components/BattleLog.tsx`  | Right-rail event log (color-coded badges)         |
| `src/audio/`                    | ZzFX SFX presets + ZzFXM BGM cross-fade           |
| `src/store/gameStore.ts`        | Zustand — room state ONLY, NO animation state     |

## Scripts

- `pnpm dev` — Vite dev server on `:5173`
- `pnpm build` — production bundle to `dist/`
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm test` — Vitest
