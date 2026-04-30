// RevealGlyphs — overlay container that renders one large gesture badge
// (✊ rock / ✋ paper / ✌️ scissors) above each alive player's station for
// the §H2 REVEAL hold (PHASE_T_REVEAL = 1500ms).
//
// Why a separate container
// ------------------------
// The reveal frame is a stage-level overlay, not a per-character pose:
// it sits above every alive station simultaneously, fades in/out as a
// unit, and is cleared the moment the action timeline begins. Coupling
// it to Character would entangle the gesture indicator with the
// character's own state machine; a flat overlay container keeps both
// concerns decoupled and lets the EffectPlayer toggle the whole thing
// in two calls (`show(throws)` at REVEAL start, `hide()` at PHASE_T_REVEAL).
//
// Why drawn shapes (not emoji)
// ----------------------------
// Color emoji glyphs (✊✋✌️) require system fonts (Apple/Segoe/Noto Color
// Emoji) that are not present on every browser/OS combination — notably
// headless Chromium on Linux renders them as empty boxes. Drawing the
// indicator with Pixi Graphics is platform-independent and guarantees
// the §H2 acceptance test (every alive player shows the same throw
// shape) holds in CI screenshots and on Android Chrome alike.
//
// Badge size: 96px circle, with a 24px-stroke shape inside, so the whole
// thing reads at ≥ 64px §H2 spec on a 360px-wide mobile viewport. Color
// is the per-player palette ring with a near-white fill — a viewer
// matches badge → station with a glance, no matter where the alive
// players are arranged in the §C9 layout.
//
// Anchoring: the host (GameStage) supplies a (charX, charY) position
// for each player; the badge centers on charX and floats `Y_OFFSET`
// pixels above the character's feet so the head + badge stack stays
// inside the gameplay band on every layout (2-6 players, all four §C9
// arrangements).

import { Container, Graphics } from 'pixi.js';
import { palette, playerColor } from '../palette.js';

export type RevealChoice = 'ROCK' | 'PAPER' | 'SCISSORS';

/** Pixels above the character's feet (view.y). Tuned so a 1.0-scale
 *  character's head is below the badge baseline on every §C9 layout. */
const Y_OFFSET = 180;

/** Outer circle radius. The badge is 2*RADIUS px wide — matches the
 *  §H2 spec of ≥ 64 px and is readable on 360px-wide mobile. */
const RADIUS = 48;

/** Inner shape stroke / fill weight. */
const SHAPE_STROKE = 10;

interface ActiveGlyph {
  graphics: Graphics;
  playerId: string;
}

export interface RevealAnchor {
  /** World x (gameplay-layer coords) — typically the character's homeX. */
  x: number;
  /** World y (gameplay-layer coords) — typically the character's feet y. */
  y: number;
  /** Character's effective uniform display scale (per-§C9 layout). The
   *  badge offset is scaled by this so back-row players' badges sit at
   *  a proportional offset above the smaller sprites. */
  scale: number;
}

/** Draw the gesture shape inside the badge. The badge is centered on
 *  (0, 0); the shape fits inside a circle of radius `r`.
 *
 *  All three shapes are constructed from filled circles only — Pixi v8
 *  Graphics treats each `circle().fill()` call as a complete sub-path
 *  with its own fill, which guarantees every primitive lands on the
 *  canvas regardless of how the surrounding chain is composed. Using
 *  filled circles also keeps the shapes readable per §H2 even on a
 *  360px-wide mobile viewport, where stroke-only V's would alias into
 *  invisibility. */
function drawShape(g: Graphics, choice: RevealChoice, color: number, r: number): void {
  switch (choice) {
    case 'ROCK': {
      // Fist body + knuckle bumps — filled circles only.
      g.circle(0, 0, r * 0.6).fill({ color });
      for (let i = -1.5; i <= 1.5; i += 1) {
        g.circle(i * r * 0.24, -r * 0.5, r * 0.18).fill({ color });
      }
      break;
    }
    case 'PAPER': {
      // Open palm: a wide palm oval + four finger ovals + thumb.
      g.circle(0, r * 0.25, r * 0.65).fill({ color });
      for (let i = -1; i <= 1; i += 1) {
        g.circle(i * r * 0.36, -r * 0.35, r * 0.18).fill({ color });
      }
      g.circle(-r * 0.6, -r * 0.05, r * 0.18).fill({ color });
      break;
    }
    case 'SCISSORS': {
      // Two-finger V: a palm anchor + two extended fingers built from
      // stacked circles. Reads as scissors / peace sign.
      g.circle(0, r * 0.35, r * 0.5).fill({ color });
      const ix = -r * 0.28;
      g.circle(ix, -r * 0.05, r * 0.16).fill({ color });
      g.circle(ix * 0.7, -r * 0.4, r * 0.16).fill({ color });
      g.circle(ix * 0.4, -r * 0.72, r * 0.16).fill({ color });
      const mx = r * 0.28;
      g.circle(mx, -r * 0.05, r * 0.16).fill({ color });
      g.circle(mx * 0.7, -r * 0.4, r * 0.16).fill({ color });
      g.circle(mx * 0.4, -r * 0.72, r * 0.16).fill({ color });
      break;
    }
  }
  void SHAPE_STROKE;
}

export class RevealGlyphs {
  readonly view: Container;
  private active: ActiveGlyph[] = [];

  constructor() {
    this.view = new Container();
    this.view.visible = false;
  }

  /** Render one badge per (playerId, choice) pair at the supplied anchor.
   *  Replaces any prior reveal frame in flight. */
  show(
    throws: ReadonlyArray<{ playerId: string; choice: RevealChoice }>,
    anchorFor: (playerId: string) => RevealAnchor | undefined,
  ): void {
    this.clear();
    for (const { playerId, choice } of throws) {
      const anchor = anchorFor(playerId);
      if (!anchor) continue;
      const ringColor = playerColor(playerId);
      const g = new Graphics();
      // Outer drop-shadow plate so the badge reads against busy
      // backgrounds (mountains/sky) without alpha mixing tricks.
      g.circle(2, 4, RADIUS + 2).fill({ color: 0x000000, alpha: 0.35 });
      // Badge body — near-white fill with the player's palette ring.
      g.circle(0, 0, RADIUS).fill({ color: 0xfdfdf6 });
      g.circle(0, 0, RADIUS).stroke({ color: ringColor, width: 6 });
      // Inner gesture shape, drawn in the player's color so a viewer can
      // still match shape → station even on a desaturated display.
      drawShape(g, choice, ringColor, RADIUS - 4);
      g.x = anchor.x;
      g.y = anchor.y - Y_OFFSET * anchor.scale;
      this.view.addChild(g);
      this.active.push({ graphics: g, playerId });
    }
    this.view.visible = this.active.length > 0;
    void palette; // keep palette referenced for future styling tweaks
  }

  /** Tear down the current frame. Idempotent. */
  hide(): void {
    this.clear();
    this.view.visible = false;
  }

  private clear(): void {
    for (const g of this.active) {
      this.view.removeChild(g.graphics);
      g.graphics.destroy();
    }
    this.active = [];
  }

  destroy(): void {
    this.clear();
    this.view.destroy({ children: true });
  }
}
