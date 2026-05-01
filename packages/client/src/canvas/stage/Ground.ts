// Ground layer: a perspective-tinted dirt road with stripe accents.
// Parallax 100% (the gameplay-world plane).
//
// v6 §K1 — the floor now reads as a 2:1 dimetric ISO plane: a grid of
// diamond tiles whose vertical diagonals all point at a single
// vanishing point at the top of the playable rect (the horizon line).
// This gives the stage the modern Steam-indie iso look (Hades / Stardew
// / Don't Starve) without rotating individual sprites — characters
// stay upright, only the floor tilts.  Implementation: we project a
// world-coord tile grid through `iso.ts`'s 2:1 dimetric matrix and
// paint each tile's parallelogram outline + alternating fill.  The
// near tiles (front of the stage) appear larger because the camera is
// "above and behind" — a flat side-view ground line cannot reproduce
// this depth cue.

import { Container, Graphics } from 'pixi.js';
import { palette } from '../../palette.js';
import { ISO_COS, ISO_SIN, isoTilePoly, worldToScreen } from './iso.js';

export class Ground {
  readonly view: Container;
  private width: number;
  private height: number;
  private readonly g: Graphics;

  /** Y coordinate (in world space) of the horizon — characters stand on this. */
  groundY = 0;
  /** Override of the horizon line. When non-null `draw()` honors this
   *  instead of the default `h * 0.62` band. Used by GameStage to align
   *  the painted ground with the playable rect on narrow viewports
   *  (FINAL_GOAL §H1). */
  private horizonOverride: number | null = null;
  /** Override of groundY (front row baseline). */
  private groundYOverride: number | null = null;

  constructor(width: number, height: number) {
    this.view = new Container();
    this.width = width;
    this.height = height;
    this.g = new Graphics();
    this.view.addChild(this.g);
    this.draw();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.draw();
  }

  /** Set explicit horizon + ground Y bands. Called from GameStage's
   *  layoutPlayers() so the painted ground sits inside the playable
   *  rect (canvas height minus header / bottom-sheet chrome). */
  setBands(horizonY: number, groundY: number): void {
    const h = this.height;
    const horizon = clamp(horizonY, 0, h);
    const ground = clamp(groundY, horizon + 8, h);
    if (this.horizonOverride === horizon && this.groundYOverride === ground) return;
    this.horizonOverride = horizon;
    this.groundYOverride = ground;
    this.draw();
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    const w = this.width;
    const h = this.height;
    const horizon = this.horizonOverride ?? h * 0.62;
    this.groundY = this.groundYOverride ?? h * 0.82;

    // Far ground band (tints to the horizon) — sky-meets-ground rim.
    g.rect(0, horizon, w, h - horizon).fill({ color: palette.groundDark });

    // ===== ISO TILE GRID (§K1) =====
    //
    // Project a square of (NX × NZ) tiles in world-XZ coords through the
    // 2:1 dimetric transform and paint each one as a parallelogram.
    // Origin is centered horizontally and anchored at the front (bottom)
    // of the playable rect so the near edge of the grid sits at screen-
    // bottom-center, and the deep edge converges toward `horizon`.
    //
    // Tile pitch is sized so the grid spans the full horizontal width
    // at the front and tapers to ~10% width at the horizon — this is
    // implicit in the iso projection (depth tiles are smaller because
    // they're farther into the +Z axis of the projection).
    //
    // The tile fill alternates light/mid/dark so adjacent diamonds are
    // distinguishable; the back rows fade into `groundDark` so the
    // grid blends into the horizon haze rather than ending in a hard
    // line.
    const groundY = this.groundY;
    const playableH = groundY - horizon;
    // Choose tile size so ~5 rows fit between horizon and ground.
    const tileW = Math.max(48, playableH / 4);
    const NX = 9;            // horizontal tile count
    const NZ = 8;            // depth tile count (toward horizon)
    // Origin of the iso plane: bottom-center of the visible rect, lifted
    // by half a tile so the near-corner of tile (0,0) lands at groundY.
    // Centering the grid on the X axis: shift left by NX/2 tiles in
    // world coords so tile column 0 starts at the playable left.
    const halfNX = (NX * tileW) / 2;
    const originX = w / 2;
    const originY = groundY - tileW * ISO_SIN; // near-row sits on the ground line

    // Compute the screen y of the deepest row's BACK corner — we use
    // this to place the haze rectangle that fades the grid into the
    // horizon.
    const farBack = worldToScreen(NX * tileW - halfNX, NZ * tileW, 0, originX, originY);

    // Backdrop: solid mid-ground fill from horizon down to the front
    // row, plus a subtle vertical gradient via stacked thin rects so
    // the iso grid sits on a real ground band rather than empty bg.
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const y = horizon + (h - horizon) * t;
      const bandH = (h - horizon) / bands + 1;
      const color = lerpColor(palette.groundDark, palette.groundLight, t);
      g.rect(0, y, w, bandH).fill({ color });
    }

    // Tile colors — three-tone alternation gives visible iso depth.
    const tileColors = [
      lerpColor(palette.groundDark, palette.groundMid, 0.45),
      palette.groundMid,
      lerpColor(palette.groundMid, palette.groundLight, 0.55),
    ];
    const stripeColor = palette.roadStripe;

    // Paint tiles back-to-front (larger Z first) so near tiles overlap
    // far tiles correctly along their diamond edges.
    for (let zi = NZ - 1; zi >= 0; zi--) {
      for (let xi = 0; xi < NX; xi++) {
        const wx = xi * tileW - halfNX;
        const wz = zi * tileW;
        // Skip tiles whose far corner sits above the horizon (clipped).
        const back = worldToScreen(wx + tileW, wz + tileW, 0, originX, originY);
        if (back.y < horizon - 8) continue;
        const poly = isoTilePoly(wx, wz, tileW, originX, originY);
        // Fade alpha as tiles approach the horizon so the grid melts
        // into the haze rather than ending in a hard back row.
        const depthT = zi / NZ;
        const alpha = 1.0 - depthT * 0.5;
        const color = tileColors[(xi + zi) % tileColors.length] ?? palette.groundMid;
        g.poly(poly).fill({ color, alpha });
        // Tile edge stroke — thin line in roadStripe so the parallelogram
        // grid is visibly drawn, the §K1 acceptance criterion.
        g.poly(poly).stroke({ color: stripeColor, width: 1, alpha: alpha * 0.6 });
      }
    }

    // Center "road" diamond stripe — the path the actor rushes along.
    // One column of tiles down the middle, painted in the lighter
    // road-stripe color so the iso plane has a visible main aisle the
    // way Hades' rooms have a focal corridor.
    const centerXi = Math.floor(NX / 2);
    for (let zi = 0; zi < NZ; zi++) {
      const wx = centerXi * tileW - halfNX;
      const wz = zi * tileW;
      const poly = isoTilePoly(wx, wz, tileW, originX, originY);
      const back = worldToScreen(wx + tileW, wz + tileW, 0, originX, originY);
      if (back.y < horizon - 8) continue;
      const depthT = zi / NZ;
      const alpha = (1.0 - depthT * 0.5) * 0.55;
      g.poly(poly).fill({ color: stripeColor, alpha });
    }

    // Horizon haze — a soft rectangle from the deepest tile row's top
    // up to the horizon line, fading the iso grid into the sky band.
    const hazeTop = Math.max(horizon, Math.min(farBack.y - 24, horizon + playableH * 0.35));
    g.rect(0, hazeTop, w, Math.max(0, horizon - hazeTop + 4)).fill({
      color: palette.groundDark,
      alpha: 0.35,
    });

    // Subtle grass tufts at horizon (small triangles) — keep these so the
    // ground-meets-sky line still has texture.
    for (let i = 0; i < 30; i++) {
      const x = (i / 30) * w + ((i * 41) % 23);
      const tuftY = horizon + 4 + ((i * 13) % 10);
      g.poly([
        x, tuftY,
        x - 4, tuftY + 6,
        x + 4, tuftY + 6,
      ]).fill({ color: 0x4a6028 });
    }
  }
}

// Suppress unused-import warning while keeping ISO_COS exported for
// downstream consumers that may want to replicate the projection in
// other ground layers.
void ISO_COS;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}
