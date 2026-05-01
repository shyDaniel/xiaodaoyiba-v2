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
  /** §H1 (S-440) — plaque overlay layer added AFTER fgLayer to
   *  app.stage so the foreground lantern sprites paint BEHIND the
   *  nameplates. Otherwise lanterns at canvas corners (Foreground.ts
   *  positions them at (60, 18) / (w-60, 18), body half-width ≈ 26 px)
   *  visually obscure the leftmost/rightmost back-row plaques —
   *  observed live as '玩家61' rendering as '家61' on desktop and
   *  '家' on 6p × 375 mobile. */
  plaqueLayer: Container;
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
        // §H1 (S-440) — plaqueLayer is the topmost stage layer so
        // nameplates paint above the foreground lantern sprites.
        // Without this, lanterns hanging at canvas corners obscure
        // the outermost back-row plaques on every viewport.
        const plaqueLayer = new Container();
        app.stage.addChild(bgLayer);
        app.stage.addChild(mountainLayer);
        app.stage.addChild(gameplayLayer);
        app.stage.addChild(fgLayer);
        app.stage.addChild(plaqueLayer);

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
        // §H1 (S-440) plaqueLayer follows the gameplay layer's
        // parallax + zoom so nameplates track their houses through
        // camera shake / PULL_PANTS zoom.
        camera.addLayer({ container: plaqueLayer, parallax: 1.0, anchorX: cx, anchorY: cy });

        // DEV-only: expose the camera handle on window for eval / Playwright
        // probing. Used by the §K3 cinematic-zoom verification harness to
        // sample camera.getScale() at the PULL_PANTS midpoint without having
        // to eyeball pixel diffs. Kept in production builds too — it's a
        // single object reference, costs nothing, and unlocks DOM-side
        // animation regression tests forever.
        (globalThis as { __xdybCamera?: Camera }).__xdybCamera = camera;

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
          plaqueLayer,
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
        for (let i = 0; i < players.length; i++) {
          const p = players[i]!;
          const house = new House({
            ownerId: p.id,
            ownerName: p.nickname,
            // v6 §K5 (S-508): native ≈ 192-wide × 168-tall; layoutPlayers
            // immediately reassigns these via house.resize(spot.houseW,
            // spot.houseH, ...) so this is just the placeholder until
            // the first layout pass runs.
            width: 192,
            height: 168,
            // v6 §K6 (S-512) — turn-order slot for art-asset hot-swap.
            slotIndex: i,
          });
          gameplayLayer.addChild(house.view);
          houses.set(p.id, house);

          const ch = new Character({
            id: p.id,
            nickname: p.nickname,
            facing: 1,
            scale: 1.0,
            // v6 §K6 (S-512) — turn-order slot for art-asset hot-swap.
            slotIndex: i,
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
    for (let i = 0; i < players.length; i++) {
      const p = players[i]!;
      seen.add(p.id);
      let ch = refs.characters.get(p.id);
      if (!ch) {
        const house = new House({
          ownerId: p.id,
          ownerName: p.nickname,
          // v6 §K5 (S-508): see mount-pass note — placeholder, immediately
          // overwritten by layoutPlayers' house.resize() call.
          width: 192,
          height: 168,
          // v6 §K6 (S-512) — turn-order slot for art-asset hot-swap.
          slotIndex: i,
        });
        refs.gameplayLayer.addChild(house.view);
        refs.houses.set(p.id, house);
        ch = new Character({
          id: p.id,
          nickname: p.nickname,
          facing: 1,
          scale: 1.0,
          // v6 §K6 (S-512) — turn-order slot for art-asset hot-swap.
          slotIndex: i,
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
          // §H1 (S-440): plaque was re-parented into plaqueLayer in
          // layoutPlayers — remove + destroy it explicitly so a
          // departing player's nameplate doesn't linger on the scene.
          if (h.plaque.parent) h.plaque.parent.removeChild(h.plaque);
          h.plaque.destroy({ children: true });
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
  // §H1 (S-411): the canvas DOM is now positioned in its own grid
  // cell — header + chips strip occupy a row above it, HandPicker
  // and BattleLog bottom-sheet toggle occupy a row below it (see
  // MultiGame.tsx + Game.tsx). The Pixi canvas drawable rect IS
  // the playable rect; we only keep a small interior gutter so
  // the outermost station's body doesn't kiss the canvas edge.
  const reserveTop = narrow ? 12 : 16;
  const reserveBottom = narrow ? 12 : 16;
  const top = reserveTop;
  const bottom = Math.max(top + 200, h - reserveBottom);
  return { top, bottom };
}

/** Horizontal canvas-internal gutter. After S-411 the React chrome
 *  (PlayerRail player-chips strip on desktop, BattleLog bottom-sheet
 *  + HandPicker bar on mobile) is positioned in its OWN grid cell
 *  outside the Pixi canvas — see MultiGame.tsx + Game.tsx — so the
 *  canvas DOM rect equals its drawable region. The remaining gutter
 *  is purely cosmetic: a small inset so the outermost station's
 *  silhouette doesn't kiss the canvas edge. The previous 160-px
 *  desktop reserve is no longer needed because no React panel sits
 *  on top of the leftmost stations. §H1. */
export function computeChromeMargins(
  w: number,
): { left: number; right: number } {
  const narrow = w < 768;
  if (narrow) {
    // §H1 (S-437): reduced from 8 → 4 to maximize per-slot width on
    // 6-bot mobile (375 canvas, 6 slots → previously 58.5 px/slot,
    // now 60.5 px/slot). Combined with House.draw's hard ribbon-
    // clamp + fontSize floor lowered to 5 px, the outermost
    // 'counter#2' plaque now stays inside the canvas right edge.
    return { left: 4, right: 4 };
  }
  return { left: 12, right: 12 };
}

function layoutPlayers(refs: SceneRefs): void {
  const w = refs.app.screen.width;
  const h = refs.app.screen.height;
  const ids = Array.from(refs.houses.keys());
  const n = ids.length;
  if (n === 0) return;

  const { top: playableTop, bottom: playableBottom } = computePlayableRect(w, h);
  const playableH = playableBottom - playableTop;
  const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);

  // Recompute the visual ground / horizon so the dirt road sits inside
  // the playable rect — without this the front-row characters would
  // appear to float above the painted ground line on mobile.
  refs.ground.setBands(playableTop + playableH * 0.5, playableBottom - 12);

  // Anchor positions for houses (bottom-center) and characters (feet).
  // Strategy: spread houses across the upper portion of the gameplay band,
  // characters slightly forward of their houses standing on the road.
  // For 2: side-by-side. For 3: 2 back + 1 front. For 4: 4 back. For 5/6: fan.
  const spots = computeSpots(n, w, playableTop, playableBottom, chromeLeft, chromeRight);

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
      // default 200×220 native size would clip past the sheet. We
      // also pass the station width budget (pre-scale, since the
      // plaque is rendered in local space and then scaled by the
      // parent — divide by `spot.scale` to compensate). §H1.
      const localStationW = spot.stationW / Math.max(0.001, spot.scale);
      house.resize(spot.houseW, spot.houseH, localStationW);
      house.view.position.set(spot.houseX, spot.houseY);
      house.view.scale.set(spot.scale, spot.scale);
      house.view.zIndex = rowBase;
      // §H1 (S-440) plaque overlay: re-parent the plaque into the
      // dedicated `plaqueLayer` (added AFTER fgLayer to app.stage)
      // so plaques paint above EVERY house row AND above the
      // foreground lantern sprites. Previously plaques lived in
      // gameplayLayer with zIndex=5000 — that worked for inter-row
      // ordering but the foreground lantern sprites in fgLayer
      // (which paints after gameplayLayer) still occluded the
      // outermost plaques against canvas-edge corners (verdict
      // iter-63: '玩家61' rendered as '家61' on desktop and '家'
      // on 6p × 375 mobile). The plaque is rendered in the house's
      // pre-scale local space, so we mirror house.view.position/
      // scale onto the plaque before it joins plaqueLayer so the
      // ribbon lands centered over the house.
      if (house.plaque.parent !== refs.plaqueLayer) {
        refs.plaqueLayer.addChild(house.plaque);
      }
      house.plaque.position.set(spot.houseX, spot.houseY);
      house.plaque.scale.set(spot.scale, spot.scale);
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
  /** Per-station horizontal budget in canvas units (post-scale). The
   *  House plaque ribbon is capped at `stationW * 0.95` so adjacent
   *  5p/6p back-row plaques never overlap and never extend past the
   *  canvas edge. The plaque is rendered in the house's *local* space
   *  and then scaled by `scale`, so House.resize() is passed
   *  `stationW / scale` to compensate. §H1. */
  stationW: number;
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
  chromeLeft = 0,
  chromeRight = 0,
): Spot[] {
  const spots: Spot[] = [];
  const playableH = bottom - top;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // Horizontal playable band — excludes left/right React-chrome reserves.
  // §H1 (S-401): on desktop, `chromeLeft = 160` reserves space for the
  // PlayerRail vertical column anchored at `left:16` so the leftmost
  // station's character body is no longer hidden behind chips. The
  // `playableX0 / playableXEnd` band replaces every previous reference
  // to the raw canvas extent (0..w) for spot placement.
  const playableX0 = chromeLeft;
  const playableXEnd = w - chromeRight;
  const playableW = Math.max(60, playableXEnd - playableX0);
  // Linear interpolation of an x-fraction (0..1) into the playable band.
  // Replaces previous `w * frac` callsites — keeps relative positioning
  // identical when chromeLeft/Right=0 (the test default).
  const px = (frac: number): number => playableX0 + playableW * frac;

  // Cap visual heights to the playable rect. The "back row" plate
  // mounts at ~50% of playable height; front row characters stand at
  // (bottom - feetMargin). House visual must clear back-row character
  // heads and not poke into front-row characters; we allot ~0.55 of
  // playable height to back-row visual house extent.
  // v6 §K5 (S-508): char native display height is 96 px (Character.ts
  // inner `art` container compresses the 128-unit poly rig × 0.75); with
  // baseScale=1.05*scale the rendered char tops out at ~101 px at scale=1.
  const charNativeH = 96 * 1.05;
  // Maximum scale that lets a 1.0-scale character fit inside playableH
  // with a small safety margin. On a 375×667 phone with reserves
  // 92/184, playableH ≈ 391; default scale 1.0 would give the front
  // row 134px of character — fine. The constraint is the back-row
  // house+character stack fitting above front row.
  const maxScale = Math.min(1.0, (playableH - 16) / (charNativeH * 1.5 + 240));

  // Default house geometry — v6 §K5 (S-508): 192-wide × 120-tall native
  // so the rendered silhouette (≈ 0.89×h walls+roof + a ~32 px plaque
  // ribbon above the apex + 6 px plinth skirt below) measures ~145 px
  // height at scale=1.0 ≈ 18-22% of an 800-px viewport per the §K5
  // contract. Live measurement at 1280×800 / 4p (canvas 776×616 after
  // grid chrome): front-row Container.getBounds() → 222 px @ baseHouseH=168;
  // dropped to baseHouseH=120 → predicted ~158 px (target 144-176 px).
  // Down from 200×220 to deliver the Steam-indie pacing the §K5 brief
  // mandates ('player house ~20% of viewport', NOT '~37%' which was
  // the live judge-final-zoom verdict pre-S-508).
  const baseHouseW = 192;
  const baseHouseH = 120;

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
    // §K5 (S-508): floor lowered from 120 → 90 to permit narrow viewport
    // shrinks below the new baseHouseH=120 if vertical chrome demands it
    // (e.g. bottom-sheet open on mobile). The legacy 120 floor predated
    // the §K5 size cut and would force houseH ≥ baseHouseH on any
    // viewport, defeating the reduction.
    return Math.max(90, (visAbove / 1.55) / scaleHint);
  };
  const fitHouseW = (perPlayer: number): number => {
    // §K5 (S-508): floor lowered 110 → 90 for the same reason as fitHouseH.
    return Math.min(baseHouseW, Math.max(90, perPlayer * 0.78));
  };

  if (n === 1) {
    const sc = Math.min(1.0, maxScale);
    spots.push({
      houseX: px(0.5),
      houseY: houseRowY,
      charX: px(0.5),
      charY: frontRowY,
      houseW: fitHouseW(playableW),
      houseH: fitHouseH(houseRowY, sc),
      scale: sc,
      facing: 1,
      row: 1,
      stationW: playableW,
    });
    return spots;
  }

  if (n === 2) {
    const sc = Math.min(1.0, maxScale);
    const hw = fitHouseW(playableW / 2);
    const hh = fitHouseH(houseRowY, sc);
    const stationW2 = playableW * 0.44; // half the band minus a 6% gutter
    spots.push({
      houseX: px(0.28),
      houseY: houseRowY,
      charX: px(0.32),
      charY: frontRowY,
      houseW: hw,
      houseH: hh,
      scale: sc,
      facing: 1,
      row: 1,
      stationW: stationW2,
    });
    spots.push({
      houseX: px(0.72),
      houseY: houseRowY,
      charX: px(0.68),
      charY: frontRowY,
      houseW: hw,
      houseH: hh,
      scale: sc,
      facing: -1,
      row: 1,
      stationW: stationW2,
    });
    return spots;
  }

  if (n === 3) {
    // Triangle: apex back-center (smaller), two front (bigger).
    const backSc = Math.min(0.85, maxScale * 0.85);
    const frontSc = Math.min(1.0, maxScale);
    const apexRowY = houseRowY - 30;
    const baseRowY = houseRowY + 18;
    const frontHW = fitHouseW(playableW / 2);
    spots.push({
      houseX: px(0.5),
      houseY: apexRowY,
      charX: px(0.5),
      charY: lerp(horizon, frontRowY, 0.4),
      houseW: fitHouseW(playableW * 0.5),
      houseH: fitHouseH(apexRowY, backSc),
      scale: backSc,
      facing: 1,
      row: 0,
      stationW: playableW * 0.5,
    });
    spots.push({
      houseX: px(0.22),
      houseY: baseRowY,
      charX: px(0.28),
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(baseRowY, frontSc),
      scale: frontSc,
      facing: 1,
      row: 1,
      stationW: playableW * 0.42,
    });
    spots.push({
      houseX: px(0.78),
      houseY: baseRowY,
      charX: px(0.72),
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(baseRowY, frontSc),
      scale: frontSc,
      facing: -1,
      row: 1,
      stationW: playableW * 0.42,
    });
    return spots;
  }

  if (n === 4) {
    // Two rows of two — back row smaller and tucked deeper into the
    // horizon so all four houses fit width-wise even on a 375px phone.
    const backSc = Math.min(0.85, maxScale * 0.85);
    const frontSc = Math.min(1.0, maxScale);
    const backHW = fitHouseW(playableW / 2);
    const frontHW = fitHouseW(playableW / 2);
    const backRowY = houseRowY - 18;
    const frontPlateY = lerp(horizon, frontRowY, 0.5);
    // Front row needs to be far enough below the back row that the
    // back-row house's roof+plaque does not poke into the front-row
    // character heads. ~64 px gap on desktop; less on mobile.
    const frontHouseY = Math.max(
      backRowY + 70,
      Math.min(houseRowY + 60, frontRowY - 24),
    );
    // Front-row outermost station sits at 0.18 / 0.82 of the playable
    // band. Use the tighter of the back/front constraints so every
    // spot's plaque budget fits inside the band.
    const stationW4 = playableW * 0.36;
    spots.push({
      houseX: px(0.28),
      houseY: backRowY,
      charX: px(0.3),
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: 1,
      row: 0,
      stationW: stationW4,
    });
    spots.push({
      houseX: px(0.72),
      houseY: backRowY,
      charX: px(0.7),
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: -1,
      row: 0,
      stationW: stationW4,
    });
    spots.push({
      houseX: px(0.18),
      houseY: frontHouseY,
      charX: px(0.22),
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: 1,
      row: 1,
      stationW: stationW4,
    });
    spots.push({
      houseX: px(0.82),
      houseY: frontHouseY,
      charX: px(0.78),
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: -1,
      row: 1,
      stationW: stationW4,
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

  // §H1 fix (S-397): re-derive station_w from the *actual* canvas
  // playable width and place every station inside its own slot so
  // adjacent plaques never collide and no station's plaque can
  // extend past the canvas edge. Two cases:
  //
  //   6p (3 back + 3 front) — the rows interleave B-F-B-F-B-F along
  //   x, so we slice usableW into n=6 equal slots and assign back to
  //   slots 0, 2, 4 and front to slots 1, 3, 5. Each station's
  //   stationW = usableW/n, regardless of row.
  //
  //   5p (2 back + 3 front) — usableW splits into 5 equal slots,
  //   with back at slots {1, 3} (between the three front slots {0,
  //   2, 4}). Same per-station width.
  //
  // The previous "frontSlot/2" stagger was the culprit: it added a
  // full half-slot offset to the back row whose own slot was
  // already frontSlot wide, so the last back-row center landed at
  // sideMargin + frontSlot*(2.5 + 0.5) = w - sideMargin. The plaque
  // (rendered at ±plaqueW/2 around the center) then extended past
  // the right edge. New scheme: every station gets its own slot of
  // width usableW/n; back vs front rows just claim alternating
  // slots. No stagger, no edge-clamp band-aid needed.
  // §H1 (S-401): the slot band uses the *playable* horizontal range
  // (excluding chromeLeft/Right) so the leftmost slot's character body
  // is not occluded by the React PlayerRail panel. `sideMargin` is the
  // gutter applied INSIDE the playable band — kept small so the houses
  // fan all the way across the available canvas, but >0 to give the
  // outermost stations breathing room from the chrome boundary.
  // §H1 (S-449): for 5p/6p layouts, raise sideMargin to absorb the
  // PLAQUE_TEXT_PAD (20 px) below so the outermost slot's center sits
  // already at clampSlot's `maxCx` — i.e. the clamp never fires and
  // never has to shrink the outermost station's stationW. Without
  // this, on 6p × 375 mobile the rightmost slot collapsed from
  // slotW≈60 to stationW≈28, leaving the plaque ribbon too narrow
  // (~25 px) for any token — even the ellipsis-fallback path could
  // not fit 'c…' legibly and the plaque rendered as a per-character
  // vertical column ('counter#2' → 9 stacked single chars). Raising
  // sideMargin trades ~5 px of per-slot width (slotW 60 → 54.5 on
  // mobile 6p) for guaranteed-uniform per-slot width across all six
  // stations, no clampSlot collapse, and a plaqueW that always fits
  // 'counter\n#2' on two lines. For n ≤ 4 the slots are already wide
  // enough that the clamp barely fires, so we keep the smaller
  // 4 px / 8 px gutter to maximize visual fan-out.
  const fanCount = n;
  const tightFan = fanCount >= 5;
  const sideMargin = tightFan ? 24 : (w < 768 ? 4 : 8);
  const slotBandX0 = playableX0 + sideMargin;
  const usableW = playableW - 2 * sideMargin;
  const slotCount = n;
  const slotW = usableW / slotCount;
  // Per-row house body widths. Body must fit inside the slot with a
  // small gutter so neighbour silhouettes don't kiss AND the
  // outermost slot's body can't extend past the canvas edge. The
  // body silhouette occupies (houseW * 0.78 + 32) * scale post-
  // transform — see houseBox() in layout.test.ts. We back-solve for
  // a houseW that keeps that silhouette inside slotW * 0.92 (8% of
  // slot held back as gutter against neighbours and edges).
  const fitSlotHW = (slot: number, sc: number): number => {
    // (hw * 0.78 + 32) * sc <= slot * 0.92  →  hw <= (slot*0.92/sc - 32) / 0.78
    const hwCap = (slot * 0.92 / Math.max(0.001, sc) - 32) / 0.78;
    // Floor of 70 — at 375 mobile × 6p the slot is ~60 px, sc is
    // 0.66, and the cap math yields ~65. Anything below 70 starts
    // to read as a tiny dollhouse rather than a station, but a
    // 6p mobile room is the worst case and an 80-px body there is
    // an honest tradeoff against truncation.
    return Math.min(baseHouseW, Math.max(70, Math.min(hwCap, slot * 0.78)));
  };
  const backHW = fitSlotHW(slotW, backSc);
  const frontHW = fitSlotHW(slotW, frontSc);

  // Slot indices. For n=6 → back claims {0,2,4}, front {1,3,5}. For
  // n=5 → front claims {0,2,4}, back {1,3} (back inset between
  // wider front pairs). This guarantees a B-F-B-F-... reading order
  // left-to-right at every viewport.
  const backSlots: number[] = [];
  const frontSlots: number[] = [];
  if (backCount === frontCount) {
    // Even-count rows: back at even slots, front at odd slots.
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) backSlots.push(i);
      else frontSlots.push(i);
    }
  } else {
    // 5p: front (3) wider, back (2) inset between front pairs.
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) frontSlots.push(i);
      else backSlots.push(i);
    }
  }

  // §H1 (S-441) — canvas-edge clamp for the OUTERMOST station(s) in
  // each row. The brief from iter61 / iter63 explicitly prescribes:
  // *after* the per-station plaque budget is computed, clamp station.x
  // to [canvasLeft + plaqueWmax/2 + sideMargin, canvasRight -
  //     plaqueWmax/2 - sideMargin]
  // S-440 attempted this but used `stW * 0.95` as the plaqueHalf
  // estimate. That is WRONG: House.draw clamps the actual plaque
  // ribbon at `min(minRibbon, max(40, opts.stationW))` (in local
  // space), which after the parent's `scale` multiplier yields a
  // canvas-space plaque ribbon up to `stationW` wide — a full 5%
  // wider than the S-440 estimate. On a 122-px desktop slot that
  // leaves ~3 px of half-width unaccounted for; combined with the
  // PLAQUE_TEXT_PAD rasterization overshoot, the rightmost slot's
  // text texture still landed ~3 px past the canvas right edge —
  // exactly the 'counter#2' trailing-glyph clip iter63 documented at
  // 1280×800. The same root cause produces the leftmost '玩家NN'
  // clip at 375×667.
  //
  // S-441 fix: drop the 0.95 factor. plaqueHalf = stW/2 +
  // PLAQUE_TEXT_PAD. This is the *true ceiling* of the canvas-space
  // plaque + texture overshoot; with this estimate the clamp becomes
  // a hard contract that matches the §H1 acceptance gate (plaque
  // ribbon AND rasterized text both inside canvas±4) regardless of
  // font-fallback width.
  //
  // PLAQUE_TEXT_PAD=20 still absorbs the bold-700 PingFang-fallback
  // rasterization overshoot. The lantern-overlap concern from S-440
  // is addressed independently by the dedicated `plaqueLayer` added
  // AFTER fgLayer to app.stage (see GameStage init); plaques paint
  // above the foreground lanterns regardless of x position.
  const PLAQUE_TEXT_PAD = 20; // S-440: bumped 10 → 20 for bold-fallback rasterization overshoot
  const edgeMargin = 4; // §H1 acceptance: plaque.left ≥ 4, plaque.right ≤ w-4
  const clampSlot = (cx: number, stW: number): { cx: number; stationW: number } => {
    // Plaque-aware half-width: full slot is the canvas-space ceiling
    // for the plaque ribbon (House.draw clamps to ≤ stationW), plus
    // PLAQUE_TEXT_PAD for Pixi's bold-fallback rasterization
    // overshoot. S-441: removed the spurious 0.95 factor that left
    // 5% of half-width unaccounted for and let the rightmost
    // 'counter#2' texture spill past canvas-right by ~3 px live.
    const plaqueHalf = stW / 2 + PLAQUE_TEXT_PAD;
    const minCx = edgeMargin + plaqueHalf;
    const maxCx = w - edgeMargin - plaqueHalf;
    if (cx < minCx) {
      // Push inward; tighten stationW symmetrically by twice the push so
      // the adjacent slot's right boundary doesn't get crowded.
      const push = minCx - cx;
      return { cx: minCx, stationW: Math.max(40, stW - 2 * push) };
    }
    if (cx > maxCx) {
      const push = cx - maxCx;
      return { cx: maxCx, stationW: Math.max(40, stW - 2 * push) };
    }
    return { cx, stationW: stW };
  };

  for (let bi = 0; bi < backCount; bi++) {
    const slotIdx = backSlots[bi];
    if (slotIdx === undefined) continue;
    const rawCx = slotBandX0 + slotW * (slotIdx + 0.5);
    const clamped = clampSlot(rawCx, slotW);
    // backCount is statically `2 | 3` (5p → 2, 6p → 3) so the singleton
    // case never fires here; just normalize bi against (backCount - 1).
    // S-430 fix: previous `backCount === 1` guard tripped TS2367 under
    // strict mode because the comparison is unreachable.
    const t = bi / (backCount - 1);
    spots.push({
      houseX: clamped.cx,
      houseY: backRowY,
      charX: clamped.cx,
      charY: frontPlateY,
      houseW: backHW,
      houseH: fitHouseH(backRowY, backSc),
      scale: backSc,
      facing: t < 0.5 ? 1 : -1,
      row: 0,
      stationW: clamped.stationW,
    });
  }

  for (let fi = 0; fi < frontCount; fi++) {
    const slotIdx = frontSlots[fi];
    if (slotIdx === undefined) continue;
    const rawCx = slotBandX0 + slotW * (slotIdx + 0.5);
    const clamped = clampSlot(rawCx, slotW);
    const t = frontCount === 1 ? 0.5 : fi / Math.max(1, frontCount - 1);
    spots.push({
      houseX: clamped.cx,
      houseY: frontHouseY,
      charX: clamped.cx,
      charY: frontRowY,
      houseW: frontHW,
      houseH: fitHouseH(frontHouseY, frontSc),
      scale: frontSc,
      facing: t < 0.5 ? 1 : -1,
      row: 1,
      stationW: clamped.stationW,
    });
  }
  return spots;
}
