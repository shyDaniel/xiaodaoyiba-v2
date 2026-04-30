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
import {
  DustEmitter,
  ClothEmitter,
  WoodChipEmitter,
  ConfettiEmitter,
} from './particles/index.js';
import { Camera } from './camera/index.js';
import { RevealGlyphs } from './RevealGlyphs.js';

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
  camera: Camera;
  dust: DustEmitter;
  cloth: ClothEmitter;
  woodChips: WoodChipEmitter;
  confetti: ConfettiEmitter;
  revealGlyphs: RevealGlyphs;
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

        // Particle emitters. Dust/cloth/wood-chips live on the gameplay
        // layer (same parallax band as characters and houses) so they
        // appear in front of the houses but behind the foreground decor.
        // Confetti lives on the foreground layer so it overlays the
        // entire scene at game-over.
        const dust = new DustEmitter();
        const cloth = new ClothEmitter();
        const woodChips = new WoodChipEmitter();
        const confetti = new ConfettiEmitter();
        const revealGlyphs = new RevealGlyphs();
        gameplayLayer.addChild(dust.view);
        gameplayLayer.addChild(cloth.view);
        gameplayLayer.addChild(woodChips.view);
        // Reveal glyphs sit on the gameplay layer above characters but
        // below the foreground decor — same band as cloth/wood-chip
        // particles so the glyph reads in front of the houses.
        // Houses and characters are added to the gameplay layer later
        // (in reconcile cycles) and would render on top by virtue of
        // child order; opt into Pixi's sortableChildren so the badge
        // overlay is forced to the front via zIndex.
        gameplayLayer.sortableChildren = true;
        revealGlyphs.view.zIndex = 100;
        gameplayLayer.addChild(revealGlyphs.view);
        fgLayer.addChild(confetti.view);

        // Camera owns translate/scale of all four parallax layers.
        // Per-layer parallax factors per FINAL_GOAL §C5:
        //   sky      0.1   (slowest, almost stationary on shake)
        //   mountain 0.3   (slow drift)
        //   gameplay 1.0   (1:1 with camera)
        //   foreground 1.3 (more than 1:1 — closer than gameplay)
        // Sky/mountain layers don't scale with zoom (a panorama doesn't
        // bloom); gameplay+foreground do. Anchors center each layer
        // around the screen midpoint so a zoom-in keeps the visible
        // composition centered rather than pulling toward (0,0).
        const camera = new Camera();
        const cx = w / 2;
        const cy = h / 2;
        camera.addLayer({ container: bgLayer, parallax: 0.1, zooms: false, anchorX: cx, anchorY: cy });
        camera.addLayer({ container: mountainLayer, parallax: 0.3, zooms: false, anchorX: cx, anchorY: cy });
        camera.addLayer({ container: gameplayLayer, parallax: 1.0, anchorX: cx, anchorY: cy });
        camera.addLayer({ container: fgLayer, parallax: 1.3, anchorX: cx, anchorY: cy });

        // EffectPlayer reads the live characters/homeX maps via these
        // closures — so it always sees the current scene, even after
        // reconcile cycles.
        const effectPlayer = new EffectPlayer({
          getCharacter: (id) => characters.get(id),
          getHomeX: (id) => homeX.get(id),
          dust,
          cloth,
          woodChips,
          confetti,
          camera,
          revealGlyphs: {
            show: (throws) => {
              revealGlyphs.show(throws, (id) => {
                const ch = characters.get(id);
                const hx = homeX.get(id);
                if (!ch || hx === undefined) return undefined;
                // Use the character's absolute scale (positive value)
                // — view.scale.x is signed by facing, view.scale.y is
                // always positive and matches the §C9 layout scale.
                return { x: hx, y: ch.view.y, scale: ch.view.scale.y };
              });
            },
            hide: () => revealGlyphs.hide(),
          },
          getViewportSize: () => ({
            width: app.screen.width,
            height: app.screen.height,
          }),
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
          dust,
          cloth,
          woodChips,
          confetti,
          revealGlyphs,
          camera,
          resizeObserver: new ResizeObserver(() => {
            const ww = Math.max(1, host.clientWidth);
            const hh = Math.max(1, host.clientHeight);
            app.renderer.resize(ww, hh);
            bg.resize(ww, hh);
            mountains.resize(ww, hh);
            ground.resize(ww, hh);
            fg.resize(ww, hh);
            layoutPlayers(refs);
            // Recenter camera anchors on the new viewport center so a
            // resize during a zoom doesn't pull the composition off
            // screen. Cheaper than a full re-add: the Camera's layer
            // list is small (4 entries) and anchors are public.
            camera.recenterAnchors(ww / 2, hh / 2);
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
          // Particle physics. All four channels share the same dt so
          // their integrated state stays in lockstep with the rest of
          // the scene (no drift on tab-throttle resume because dt is
          // clamped to 64ms above).
          dust.update(dt);
          cloth.update(dt);
          woodChips.update(dt);
          confetti.update(dt);
          // Camera last — its transforms read positions just written by
          // characters/particles this frame, so applying camera transforms
          // after gameplay updates avoids a one-frame lag.
          camera.update(dt);
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
          refs.dust.destroy();
          refs.cloth.destroy();
          refs.woodChips.destroy();
          refs.confetti.destroy();
          refs.revealGlyphs.destroy();
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

/** Compute the y-band of the canvas the layout treats as "playable"
 *  — i.e. not covered by the React chrome (header / player-chips strip
 *  on top, HandPicker + BattleLog sheet toggle on the bottom). Pure
 *  function exported for §H1 tests.
 *
 *  Position houses + characters per FINAL_GOAL §C9 layout rules. On
 *  narrow viewports the React chrome (header + player-chips strip +
 *  bottom-sheet HandPicker bar) overlays the canvas, so the *visible*
 *  canvas area is smaller than `app.screen`. We reserve a top chrome
 *  band (header + chips strip) and a bottom chrome band (HandPicker
 *  + sheet toggle) and shrink/pack houses and characters into that
 *  effective playable rect so every house + nameplate + ankle-briefs
 *  renders fully on every (player_count ∈ {2..6}) × (viewport ∈
 *  {1280×800, 375×667}) combination. */
export function computePlayableRect(
  w: number,
  h: number,
): { top: number; bottom: number } {
  const narrow = w < 768;
  const reserveTop = narrow ? 92 : 64;
  // Bottom reserve must clear: HandPicker (~80px) + footer hint
  // (~24px) + footer padding (~24px) + the sheet-toggle button
  // (~36px height anchored at bottom:132). 132 + 36 = 168, plus some
  // safety so the toggle's top edge doesn't kiss the character feet.
  const reserveBottom = narrow ? 184 : 92;
  const top = reserveTop;
  const bottom = Math.max(top + 200, h - reserveBottom);
  return { top, bottom };
}

function layoutPlayers(refs: SceneRefs): void {
  const w = refs.app.screen.width;
  const h = refs.app.screen.height;
  const ids = Array.from(refs.houses.keys());
  const n = ids.length;
  if (n === 0) return;

  const { top: playableTop, bottom: playableBottom } = computePlayableRect(w, h);
  const playableH = playableBottom - playableTop;

  // Recompute the visual ground / horizon so the dirt road sits inside
  // the playable rect — without this the front-row characters would
  // appear to float above the painted ground line on mobile.
  refs.ground.setBands(playableTop + playableH * 0.5, playableBottom - 12);

  // Anchor positions for houses (bottom-center) and characters (feet).
  // Strategy: spread houses across the upper portion of the gameplay band,
  // characters slightly forward of their houses standing on the road.
  // For 2: side-by-side. For 3: 2 back + 1 front. For 4: 4 back. For 5/6: fan.
  const spots = computeSpots(n, w, playableTop, playableBottom);

  // §H1 z-order: deeper-into-scene houses paint first. We assign zIndex
  // by y-anchor (higher y = closer to camera). Houses get an even
  // zIndex; characters get the odd zIndex one above their own house —
  // so a back-row house (small y) paints behind a front-row character
  // (big y) regardless of insertion order.
  refs.gameplayLayer.sortableChildren = true;

  for (let i = 0; i < n; i++) {
    const id = ids[i];
    if (id == null) continue;
    const spot = spots[i];
    if (!spot) continue;
    const house = refs.houses.get(id);
    const ch = refs.characters.get(id);
    // §H1 z-order: stations are layered by row, NOT by raw y-position.
    // A back-row character sits at a larger y than a back-row house but
    // smaller y than a front-row house, so a y-keyed zIndex would paint
    // back-row characters ON TOP of front-row houses (the iter-47 bug:
    // back chars covered the front houses, hiding three of six houses
    // behind them). Instead each spot carries an explicit `row` (0=back,
    // 1=front) and we assign zIndex = row*1000 + (house|char offset),
    // so the back row paints fully (house→char→ground noise) before
    // the front row begins, and no character ever paints over a house
    // from a later row.
    const rowBase = spot.row * 1000;
    if (house) {
      // Re-size the house geometry so its native dimensions match the
      // spot's allotted box — critical on narrow viewports where the
      // default 200×220 native size would clip past the sheet.
      house.resize(spot.houseW, spot.houseH);
      house.view.position.set(spot.houseX, spot.houseY);
      house.view.scale.set(spot.scale, spot.scale);
      house.view.zIndex = rowBase;
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
      // Character sits one notch above its OWN house's row, so it
      // paints in front of its house but still behind any house in a
      // later row. Within a row we add 1 so the character paints over
      // its own house's stoop.
      ch.view.zIndex = rowBase + 1;
    }
  }
}

/** Per-station layout output. Exported for §H1 test coverage so the
 *  spot bounding boxes can be asserted against the playable rect. */
export interface Spot {
  houseX: number;
  houseY: number;
  charX: number;
  charY: number;
  /** Native house geometry (House.draw uses these as bodyW/bodyH bases).
   *  Adjusted per-viewport so the 200×220 default doesn't clip on
   *  narrow phones — see §H1. */
  houseW: number;
  houseH: number;
  scale: number;
  facing: 1 | -1;
  /** Row index (0 = back row, 1 = front row). Used by layoutPlayers
   *  to assign a row-based zIndex that guarantees back-row characters
   *  paint behind front-row houses (FINAL_GOAL §H1). */
  row: 0 | 1;
}

/** Compute station spots within an explicit playable rect. The rect
 *  excludes top chrome (header + player chips) and bottom chrome
 *  (HandPicker + sheet toggle) so on narrow viewports houses do not
 *  hide behind UI panels (FINAL_GOAL §H1).
 *
 *  House extents (post-draw, anchor at bottom-center): the body covers
 *  y ∈ [-bodyH, 0]; the roof peaks at y ≈ -bodyH - h*0.4; the plaque
 *  ribbon adds ~32px above the roof. Total visual height ≈ 1.55*houseH.
 *  Therefore for a target visual height H_vis we pick houseH = H_vis/1.55.
 *  Character native height ≈ 128 from feet up; with baseScale=1.05*scale
 *  the front-row needs charY - 134*scale ≥ playableTop. */
export function computeSpots(
  n: number,
  w: number,
  top: number,
  bottom: number,
): Spot[] {
  const spots: Spot[] = [];
  const playableH = bottom - top;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

  // Cap visual heights to the playable rect. The "back row" plate
  // mounts at ~50% of playable height; front row characters stand at
  // (bottom - feetMargin). House visual must clear back-row character
  // heads and not poke into front-row characters; we allot ~0.55 of
  // playable height to back-row visual house extent.
  const charNativeH = 128 * 1.05; // Character.ts head-top y = -128, baseScale = 1.05*scale
  // Maximum scale that lets a 1.0-scale character fit inside playableH
  // with a small safety margin. On a 375×667 phone with reserves
  // 92/184, playableH ≈ 391; default scale 1.0 would give the front
  // row 134px of character — fine. The constraint is the back-row
  // house+character stack fitting above front row.
  const maxScale = Math.min(1.0, (playableH - 16) / (charNativeH * 1.5 + 240));

  // Default house geometry — tuned for desktop 1280×800. We narrow it
  // down for mobile / >2 players (more bodies → less width per body).
  const baseHouseW = 200;
  const baseHouseH = 220;

  // Row Y positions inside the playable rect. The original code
  // anchored to the painted ground band (Ground.groundY) which lives
  // at h*0.82 of the *full* canvas. On mobile that x is clipped by
  // the bottom sheet. We anchor instead to the playable rect: front
  // row characters' feet at `bottom - 8`, back row at the playable
  // midpoint.
  const frontRowY = bottom - 8;
  const horizon = top + playableH * 0.5;
  const houseRowY = horizon + 8;

  // Per-row house native geometry. Character feet ride at frontRowY;
  // house bottoms ride at houseRowY (back) or houseRowY + offset.
  // Cap per-spot height so the house's visual extent (≈ 1.55*houseH
  // including the roof + plaque) never exceeds the available space
  // above frontRowY for that row.
  const fitHouseH = (rowY: number, scaleHint: number): number => {
    const visAbove = rowY - top - 8; // px above the row anchor
    const naturalVisH = baseHouseH * 1.55 * scaleHint;
    if (naturalVisH <= visAbove) return baseHouseH;
    return Math.max(120, (visAbove / 1.55) / scaleHint);
  };
  const fitHouseW = (perPlayer: number): number => {
    return Math.min(baseHouseW, Math.max(110, perPlayer * 0.78));
  };

  if (n === 1) {
    const sc = Math.min(1.0, maxScale);
    spots.push({
      houseX: w * 0.5,
      houseY: houseRowY,
      charX: w * 0.5,
      charY: frontRowY,
      houseW: fitHouseW(w),
      houseH: fitHouseH(houseRowY, sc),
      scale: sc,
      facing: 1,
      row: 1,
    });
    return spots;
  }

  if (n === 2) {
    const sc = Math.min(1.0, maxScale);
    const hw = fitHouseW(w / 2);
    const hh = fitHouseH(houseRowY, sc);
    spots.push({
      houseX: w * 0.28,
      houseY: houseRowY,
      charX: w * 0.32,
      charY: frontRowY,
      houseW: hw,
      houseH: hh,
      scale: sc,
      facing: 1,
      row: 1,
    });
    spots.push({
      houseX: w * 0.72,
      houseY: houseRowY,
      charX: w * 0.68,
      charY: frontRowY,
      houseW: hw,
      houseH: hh,
      scale: sc,
      facing: -1,
      row: 1,
    });
    return spots;
  }

  if (n === 3) {
    // Triangle: apex back-center (smaller), two front (bigger).
    const backSc = Math.min(0.85, maxScale * 0.85);
    const frontSc = Math.min(1.0, maxScale);
    const apexRowY = houseRowY - 30;
    const baseRowY = houseRowY + 18;
    const frontHW = fitHouseW(w / 2);
    spots.push({
      houseX: w * 0.5,
      houseY: apexRowY,
      charX: w * 0.5,
      charY: lerp(horizon, frontRowY, 0.4),
      houseW: fitHouseW(w * 0.5),
      houseH: fitHouseH(apexRowY, backSc),
      scale: backSc,
      facing: 1,
      row: 0,
    });
    spots.push({
      houseX: w * 0.22,
      houseY: baseRowY,
      charX: w * 0.28,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(baseRowY, frontSc),
      scale: frontSc,
      facing: 1,
      row: 1,
    });
    spots.push({
      houseX: w * 0.78,
      houseY: baseRowY,
      charX: w * 0.72,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(baseRowY, frontSc),
      scale: frontSc,
      facing: -1,
      row: 1,
    });
    return spots;
  }

  if (n === 4) {
    // Two rows of two — back row smaller and tucked deeper into the
    // horizon so all four houses fit width-wise even on a 375px phone.
    const backSc = Math.min(0.85, maxScale * 0.85);
    const frontSc = Math.min(1.0, maxScale);
    const backHW = fitHouseW(w / 2);
    const frontHW = fitHouseW(w / 2);
    const backRowY = houseRowY - 18;
    const frontPlateY = lerp(horizon, frontRowY, 0.5);
    // Front row needs to be far enough below the back row that the
    // back-row house's roof+plaque does not poke into the front-row
    // character heads. ~64 px gap on desktop; less on mobile.
    const frontHouseY = Math.max(
      backRowY + 70,
      Math.min(houseRowY + 60, frontRowY - 24),
    );
    spots.push({
      houseX: w * 0.28,
      houseY: backRowY,
      charX: w * 0.3,
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: 1,
      row: 0,
    });
    spots.push({
      houseX: w * 0.72,
      houseY: backRowY,
      charX: w * 0.7,
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: -1,
      row: 0,
    });
    spots.push({
      houseX: w * 0.18,
      houseY: frontHouseY,
      charX: w * 0.22,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: 1,
      row: 1,
    });
    spots.push({
      houseX: w * 0.82,
      houseY: frontHouseY,
      charX: w * 0.78,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: -1,
      row: 1,
    });
    return spots;
  }

  // 5–6 players: split into TWO rows so adjacent station bounding
  // boxes don't overlap. With a single arc the 6p case packs stations
  // ~w/6 apart along the bottom edge — at 1280×800 that's ~213 px per
  // slot, smaller than a baseHouseW * 0.78 = 156 px sprite plus its
  // plaque (cap = w * 1.0). Splitting reserves wider per-station x
  // budget per row.
  //
  // 5p: 2 back + 3 front
  // 6p: 3 back + 3 front
  const backCount = n === 5 ? 2 : 3;
  const frontCount = n - backCount;
  const backSc = Math.min(0.78, maxScale * 0.78);
  const frontSc = Math.min(1.0, maxScale);
  const backRowY = houseRowY - 18;
  const frontPlateY = lerp(horizon, frontRowY, 0.5);
  const frontHouseY = Math.max(
    backRowY + 70,
    Math.min(houseRowY + 60, frontRowY - 24),
  );

  // Per-row width budget. The plaque widens with houseW (cap = houseW
  // * 1.0), so to keep adjacent plaques non-overlapping we want
  // perStationW ≥ houseW * 1.0 + 8 (an 8 px gutter). At 1280×800 with
  // 3 stations per row, perStationW = (1280 - 32) / 3 = 416, so
  // houseW ≤ ~408 — fitHouseW will cap to baseHouseW (200), well
  // within budget. At 375×667 with 3 per row, perStationW ≈ (375 -
  // 16) / 3 = 119; fitHouseW will floor to 110 and the plaque will
  // shrink to ~110 × scale, leaving a small gutter.
  const sideMargin = w < 768 ? 8 : 16;
  const usableW = w - 2 * sideMargin;
  const backHW = fitHouseW(usableW / backCount);
  const frontHW = fitHouseW(usableW / frontCount);

  // §H1 — STAGGER back row vs front row in x, so back-row plaques and
  // characters don't sit directly behind front-row stations (the
  // iter-47 misfire: with 3 back + 3 front evenly spaced, every back
  // x ≡ a front x, plaques stacked, and the eye perceived only 3
  // houses). We inset the back row by half its slot width relative
  // to the front row so the rows interleave horizontally — the back
  // stations sit between the front stations.
  const backSlot = usableW / backCount;
  const frontSlot = usableW / frontCount;
  // The interleave offset shifts the back row toward the center by
  // `frontSlot/2` so a 3-back + 3-front 6p layout reads as B-F-B-F-B-F
  // along x rather than three vertical pairs. For 5p (2 back + 3
  // front) the back row already has fewer columns, so we don't shift
  // — backCount=2 with frontCount=3 naturally falls between the
  // front's 1st-2nd and 2nd-3rd gaps.
  const stagger = backCount === frontCount ? frontSlot / 2 : 0;

  // Back row: evenly spaced, biased slightly toward center so the row
  // reads as "behind" relative to the wider front row. The back row
  // characters stand a bit deeper (smaller charY) than the front
  // plate so their feet read as sitting in front of their own house
  // but behind the front-row characters' shadows.
  for (let i = 0; i < backCount; i++) {
    const t = backCount === 1 ? 0.5 : i / (backCount - 1);
    const x = sideMargin + stagger + backSlot * (i + 0.5);
    // Clamp x inside the usable rect so the stagger doesn't push the
    // last back-row station off the right edge.
    const maxX = w - sideMargin - (backHW * 0.78 / 2 + 16) * backSc;
    const minX = sideMargin + (backHW * 0.78 / 2 + 16) * backSc;
    const cx = Math.max(minX, Math.min(maxX, x));
    spots.push({
      houseX: cx,
      houseY: backRowY,
      charX: cx,
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: t < 0.5 ? 1 : -1,
      row: 0,
    });
  }

  // Front row: evenly spaced, full width.
  for (let i = 0; i < frontCount; i++) {
    const x = sideMargin + frontSlot * (i + 0.5);
    const t = frontCount === 1 ? 0.5 : i / (frontCount - 1);
    spots.push({
      houseX: x,
      houseY: frontHouseY,
      charX: x,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: t < 0.5 ? 1 : -1,
      row: 1,
    });
  }
  return spots;
}
