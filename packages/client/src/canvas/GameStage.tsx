// GameStage — the single PixiJS Application that owns the Game stage.
//
// React mounts the canvas; PixiJS owns animation. No re-render on sprite
// tick. The component accepts a snapshot of the current room state and
// reflects it onto the Pixi scene graph imperatively. Layout strategy
// (FINAL_GOAL §C9): 2 players side-by-side, 3 triangle, 4 square, 5–6 fan.
//
// Parallax: each layer's container has its own `parallaxFactor` and the
// camera applies `cameraX * factor` per frame. Even with the camera idle
// the foreground/background drift independently (clouds, leaves, lantern
// sway), so depth reads instantly on first paint.
//
// Round choreography is owned by EffectPlayer.ts, not by this component.
// The host exposes an imperative `controllerRef` so Game.tsx can call
// `controller.play(effects, players, options)` on each round-resolve and
// have the canvas dispatch RUSH / PULL / STRIKE / RETURN at the right
// phase boundaries (FINAL_GOAL §A5 timing). React state never holds
// per-frame animation — the contract that v1's renderer collapsed.

import { Application, Container } from 'pixi.js';
import { useEffect, useRef, type MutableRefObject } from 'react';
import { Background } from './stage/Background.js';
import { Mountains } from './stage/Mountains.js';
import { Ground } from './stage/Ground.js';
import { Foreground } from './stage/Foreground.js';
import { House } from './stage/House.js';
import { Character } from './characters/Character.js';
import { EffectPlayer } from './EffectPlayer.js';

export interface StagePlayer {
  id: string;
  nickname: string;
  stage: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN' | 'DEAD';
  isSelf?: boolean;
}

/** Imperative handle exposed to React parents. The parent (Game.tsx) holds
 *  this in a ref and calls `play()` on every round-resolve. */
export interface StageController {
  /** Forward an Effect[] timeline to the canvas EffectPlayer. */
  play: EffectPlayer['play'];
  /** Reset every character to homeX + IDLE between rounds (after applying
   *  engine snapshot, before the user picks again). */
  reset: EffectPlayer['reset'];
  /** True while a play() is in flight — used by parent to gate user input. */
  isActive: () => boolean;
}

export interface GameStageProps {
  players: StagePlayer[];
  /** Imperative handle. Set when Pixi finishes initializing and cleared
   *  on unmount. Game.tsx awaits a non-null value before using it. */
  controllerRef?: MutableRefObject<StageController | null>;
  /** Optional callback fired once when the Pixi Application is ready. */
  onReady?: (app: Application) => void;
}

interface SceneRefs {
  app: Application;
  bg: Background;
  mountains: Mountains;
  ground: Ground;
  fg: Foreground;
  bgLayer: Container;
  mountainLayer: Container;
  gameplayLayer: Container;
  fgLayer: Container;
  houses: Map<string, House>;
  characters: Map<string, Character>;
  /** Home x for each character — the spot the character idles at and
   *  returns to between actions. Recomputed on every layoutPlayers(). */
  homeX: Map<string, number>;
  resizeObserver: ResizeObserver;
  effectPlayer: EffectPlayer;
}

export function GameStage({ players, controllerRef, onReady }: GameStageProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);

  // ===== Mount once =====
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    const app = new Application();
    let initialized = false;

    const initialW = Math.max(1, host.clientWidth);
    const initialH = Math.max(1, host.clientHeight);

    void app
      .init({
        background: 0x0b0d12,
        antialias: true,
        resolution: window.devicePixelRatio,
        autoDensity: true,
        width: initialW,
        height: initialH,
      })
      .then(() => {
        if (cancelled) {
          // Effect was cleaned up before init resolved; tear down the app.
          try {
            app.destroy(true, { children: true, texture: true });
          } catch {
            // Pixi v8 occasionally throws if internals never finished wiring
          }
          return;
        }
        initialized = true;
        host.appendChild(app.canvas);
        // Style the canvas so it fills the host (we manage the bitmap size
        // ourselves via renderer.resize on ResizeObserver).
        Object.assign(app.canvas.style, {
          display: 'block',
          width: '100%',
          height: '100%',
        });

        const w = app.screen.width;
        const h = app.screen.height;

        // Layer containers. Pixi has no built-in parallax — we just translate
        // these containers in the update loop.
        const bgLayer = new Container();
        const mountainLayer = new Container();
        const gameplayLayer = new Container();
        const fgLayer = new Container();
        app.stage.addChild(bgLayer);
        app.stage.addChild(mountainLayer);
        app.stage.addChild(gameplayLayer);
        app.stage.addChild(fgLayer);

        const bg = new Background({ width: w, height: h });
        const mountains = new Mountains(w, h);
        const ground = new Ground(w, h);
        const fg = new Foreground(w, h);

        bgLayer.addChild(bg.view);
        mountainLayer.addChild(mountains.view);
        gameplayLayer.addChild(ground.view);
        fgLayer.addChild(fg.view);

        const houses = new Map<string, House>();
        const characters = new Map<string, Character>();
        const homeX = new Map<string, number>();

        // EffectPlayer reads the live characters/homeX maps via these
        // closures — so it always sees the current scene, even after
        // reconcile cycles.
        const effectPlayer = new EffectPlayer({
          getCharacter: (id) => characters.get(id),
          getHomeX: (id) => homeX.get(id),
        });

        const refs: SceneRefs = {
          app,
          bg,
          mountains,
          ground,
          fg,
          bgLayer,
          mountainLayer,
          gameplayLayer,
          fgLayer,
          houses,
          characters,
          homeX,
          resizeObserver: new ResizeObserver(() => {
            const ww = Math.max(1, host.clientWidth);
            const hh = Math.max(1, host.clientHeight);
            app.renderer.resize(ww, hh);
            bg.resize(ww, hh);
            mountains.resize(ww, hh);
            ground.resize(ww, hh);
            fg.resize(ww, hh);
            layoutPlayers(refs);
          }),
          effectPlayer,
        };
        refs.resizeObserver.observe(host);
        sceneRef.current = refs;

        // Initial player layout (uses the snapshot in the closure; the
        // player-update effect below will reconcile after this).
        for (const p of players) {
          const house = new House({
            ownerId: p.id,
            ownerName: p.nickname,
            width: 200,
            height: 220,
          });
          gameplayLayer.addChild(house.view);
          houses.set(p.id, house);

          const ch = new Character({
            id: p.id,
            nickname: p.nickname,
            facing: 1,
            scale: 1.0,
          });
          if (p.stage === 'ALIVE_PANTS_DOWN') ch.setPantsDown(true);
          if (p.stage === 'DEAD') ch.setState('DEAD');
          gameplayLayer.addChild(ch.view);
          characters.set(p.id, ch);
        }
        layoutPlayers(refs);

        // Wire the imperative controller once init finishes.
        if (controllerRef) {
          controllerRef.current = {
            play: (effects, snap, options) =>
              effectPlayer.play(effects, snap, options),
            reset: (ids) => effectPlayer.reset(ids),
            isActive: () => effectPlayer.isActive(),
          };
        }

        // Animation tick (Pixi shared ticker)
        let last = performance.now();
        const tick = (): void => {
          const now = performance.now();
          const dt = Math.min(64, now - last);
          last = now;
          bg.update(dt);
          fg.update(dt);
          for (const ch of characters.values()) ch.update(dt);
        };
        app.ticker.add(tick);

        if (onReady) onReady(app);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[GameStage] Pixi init failed', err);
      });

    return () => {
      cancelled = true;
      const refs = sceneRef.current;
      if (controllerRef) controllerRef.current = null;
      if (refs) {
        try {
          refs.effectPlayer.cancel();
        } catch {
          /* noop */
        }
        try {
          refs.resizeObserver.disconnect();
        } catch {
          /* noop */
        }
        try {
          refs.app.destroy(true, { children: true, texture: true });
        } catch {
          /* Pixi v8 internal teardown can race with ticker */
        }
      } else if (initialized) {
        try {
          app.destroy(true, { children: true, texture: true });
        } catch {
          /* noop */
        }
      }
      // If init never resolved, the .then(cancelled) branch handles cleanup.
      sceneRef.current = null;
    };
    // mount-only — players are reconciled in the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Reconcile players =====
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    // Add new players, update existing
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.id);
      let ch = refs.characters.get(p.id);
      if (!ch) {
        const house = new House({
          ownerId: p.id,
          ownerName: p.nickname,
          width: 200,
          height: 220,
        });
        refs.gameplayLayer.addChild(house.view);
        refs.houses.set(p.id, house);
        ch = new Character({
          id: p.id,
          nickname: p.nickname,
          facing: 1,
          scale: 1.0,
        });
        refs.gameplayLayer.addChild(ch.view);
        refs.characters.set(p.id, ch);
      }
      // Reconcile persistent stage flags. Pants-down is sticky once true,
      // so only flip it from clothed→down (never the reverse) — that
      // matches engine semantics (a player can only become pants_down,
      // they can't recover) and avoids the in-flight slide animation
      // being clobbered by a stale snapshot mid-PULL.
      if (p.stage === 'ALIVE_PANTS_DOWN') ch.setPantsDown(true);
      if (p.stage === 'DEAD' && ch.getState() !== 'DEAD') ch.setState('DEAD');
    }
    // Remove dropped players
    for (const id of Array.from(refs.characters.keys())) {
      if (!seen.has(id)) {
        const ch = refs.characters.get(id);
        const h = refs.houses.get(id);
        if (ch) {
          refs.gameplayLayer.removeChild(ch.view);
          ch.view.destroy({ children: true });
          refs.characters.delete(id);
          refs.homeX.delete(id);
        }
        if (h) {
          refs.gameplayLayer.removeChild(h.view);
          h.view.destroy({ children: true });
          refs.houses.delete(id);
        }
      }
    }
    layoutPlayers(refs);
  }, [players]);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0b0d12',
      }}
    />
  );
}

/** Position houses + characters per FINAL_GOAL §C9 layout rules. Also
 *  records each character's homeX so EffectPlayer can derive RUSH/RETURN
 *  targets without re-querying React state. */
function layoutPlayers(refs: SceneRefs): void {
  const w = refs.app.screen.width;
  const h = refs.app.screen.height;
  const groundY = refs.ground.groundY;
  const ids = Array.from(refs.houses.keys());
  const n = ids.length;
  if (n === 0) return;

  // Anchor positions for houses (bottom-center) and characters (feet).
  // Strategy: spread houses across the upper portion of the gameplay band,
  // characters slightly forward of their houses standing on the road.
  // For 2: side-by-side. For 3: 2 back + 1 front. For 4: 4 back. For 5/6: fan.
  const spots = computeSpots(n, w, h, groundY);
  for (let i = 0; i < n; i++) {
    const id = ids[i];
    if (id == null) continue;
    const spot = spots[i];
    if (!spot) continue;
    const house = refs.houses.get(id);
    const ch = refs.characters.get(id);
    if (house) {
      house.view.position.set(spot.houseX, spot.houseY);
      house.view.scale.set(spot.scale, spot.scale);
    }
    if (ch) {
      // Snap home position only when the character is currently at a
      // previously-stored home (or has no home yet) — otherwise we'd
      // teleport an in-flight rush back to the new spot every time the
      // viewport resizes mid-action.
      const prevHome = refs.homeX.get(id);
      const atHome = prevHome === undefined || Math.abs(ch.view.x - prevHome) < 1;
      if (atHome) {
        ch.view.position.set(spot.charX, spot.charY);
      } else {
        // Update y (so a viewport resize during a horizontal tween doesn't
        // float the character) but preserve the in-flight x.
        ch.view.y = spot.charY;
      }
      const baseScale = spot.scale * 1.05;
      ch.facing = spot.facing;
      ch.view.scale.set(
        baseScale * (spot.facing === 1 ? 1 : -1),
        baseScale,
      );
      ch.setHomeX(spot.charX);
      refs.homeX.set(id, spot.charX);
    }
  }
}

interface Spot {
  houseX: number;
  houseY: number;
  charX: number;
  charY: number;
  scale: number;
  facing: 1 | -1;
}

function computeSpots(n: number, w: number, h: number, groundY: number): Spot[] {
  const spots: Spot[] = [];
  // Houses sit ~60% up; their bottom anchor lands on the back ground band.
  // Characters stand on the front ground band (groundY).
  const horizon = h * 0.62;
  const houseRowY = horizon + 8;
  const frontRowY = groundY;

  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  if (n === 1) {
    spots.push({
      houseX: w * 0.5,
      houseY: houseRowY,
      charX: w * 0.5,
      charY: frontRowY,
      scale: 1.0,
      facing: 1,
    });
    return spots;
  }

  if (n === 2) {
    spots.push({
      houseX: w * 0.28,
      houseY: houseRowY,
      charX: w * 0.32,
      charY: frontRowY,
      scale: 1.0,
      facing: 1,
    });
    spots.push({
      houseX: w * 0.72,
      houseY: houseRowY,
      charX: w * 0.68,
      charY: frontRowY,
      scale: 1.0,
      facing: -1,
    });
    return spots;
  }

  if (n === 3) {
    // Triangle: apex back-center, two front
    spots.push({
      houseX: w * 0.5,
      houseY: houseRowY - 30,
      charX: w * 0.5,
      charY: lerp(horizon, frontRowY, 0.4),
      scale: 0.85,
      facing: 1,
    });
    spots.push({
      houseX: w * 0.22,
      houseY: houseRowY + 30,
      charX: w * 0.28,
      charY: frontRowY,
      scale: 1.0,
      facing: 1,
    });
    spots.push({
      houseX: w * 0.78,
      houseY: houseRowY + 30,
      charX: w * 0.72,
      charY: frontRowY,
      scale: 1.0,
      facing: -1,
    });
    return spots;
  }

  if (n === 4) {
    // Square corners — 2 back, 2 front
    spots.push({
      houseX: w * 0.28,
      houseY: houseRowY - 18,
      charX: w * 0.3,
      charY: lerp(horizon, frontRowY, 0.5),
      scale: 0.85,
      facing: 1,
    });
    spots.push({
      houseX: w * 0.72,
      houseY: houseRowY - 18,
      charX: w * 0.7,
      charY: lerp(horizon, frontRowY, 0.5),
      scale: 0.85,
      facing: -1,
    });
    spots.push({
      houseX: w * 0.18,
      houseY: houseRowY + 60,
      charX: w * 0.22,
      charY: frontRowY,
      scale: 1.0,
      facing: 1,
    });
    spots.push({
      houseX: w * 0.82,
      houseY: houseRowY + 60,
      charX: w * 0.78,
      charY: frontRowY,
      scale: 1.0,
      facing: -1,
    });
    return spots;
  }

  // 5–6 players: fan / semicircle
  const radius = w * 0.36;
  const cx = w * 0.5;
  const cy = h * 0.95;
  for (let i = 0; i < n; i++) {
    const a = lerp(Math.PI + 0.3, -0.3, i / (n - 1));
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius * 0.55;
    spots.push({
      houseX: x,
      houseY: Math.max(houseRowY - 30, y - 130),
      charX: x,
      charY: y,
      scale: 0.8 + 0.2 * (i / n),
      facing: x < cx ? 1 : -1,
    });
  }
  return spots;
}
