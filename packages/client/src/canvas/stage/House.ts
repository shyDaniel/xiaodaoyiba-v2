// House sprite. Roof + body + door + 2 windows + chimney + name plaque.
// Per-house deterministic tinting via playerColor() (FINAL_GOAL §C9).
// Drawn at native ≥ 256px so it reads as a 2024 indie sprite, not a 2010
// HTML pixel-art prototype.

import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  TextStyle,
} from 'pixi.js';
import { palette, playerColor } from '../../palette.js';
import { ISO_SIN } from './iso.js';

/** Token-aware wrap. Splits text into "tokens" — runs of identical
 *  break-class — where:
 *    • CJK chars are each their own token (breakable on either side)
 *    • Latin word chars (a-zA-Z0-9_) cluster into a single token
 *      (NEVER broken mid-word — that's the §H1 (S-447) acceptance
 *      criterion: 'counter#2' must NOT split as 'co/unter/#2')
 *    • Non-word ASCII (#, -, _, /, ., +, ' ', etc.) is each its own
 *      token (break point allowed AFTER the punctuation)
 *
 *  Greedy-fit tokens onto lines such that no line's measured width
 *  exceeds `wrapW`. If a single Latin word-token alone exceeds
 *  `wrapW`, the caller is responsible for shrinking fontSize first
 *  (or, as a last resort, ellipsizing) — this function does NOT
 *  break mid-word. Returns the list of lines.
 *  §H1 (S-447). */
function wrapTextToWidth(
  text: string,
  wrapW: number,
  fontSize: number,
  measureW: (s: string, fs: number) => number,
): string[] {
  if (text.length === 0) return [''];
  const isWord = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
  const isCJK = (ch: string): boolean => {
    const code = ch.charCodeAt(0);
    return (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef)
    );
  };
  const out: string[] = [];
  // Honour explicit newlines first, then token-wrap each segment.
  const segments = text.split('\n');
  for (const seg of segments) {
    if (seg.length === 0) {
      out.push('');
      continue;
    }
    // Tokenize: each CJK char and each non-word ASCII is its own
    // token; consecutive Latin word chars cluster.
    const tokens: string[] = [];
    let buf = '';
    for (const ch of seg) {
      if (isCJK(ch) || !isWord(ch)) {
        if (buf.length > 0) {
          tokens.push(buf);
          buf = '';
        }
        tokens.push(ch);
      } else {
        buf += ch;
      }
    }
    if (buf.length > 0) tokens.push(buf);

    // Greedy-fit tokens. A token that ALONE overflows wrapW gets
    // placed on its own line anyway (the line will overflow visually,
    // but we never break the token mid-character — caller must
    // shrink font or ellipsize to fix).
    let cur = '';
    for (const tok of tokens) {
      const tentative = cur + tok;
      if (cur.length === 0) {
        cur = tok;
        continue;
      }
      if (measureW(tentative, fontSize) <= wrapW) {
        cur = tentative;
      } else {
        out.push(cur);
        cur = tok;
      }
    }
    if (cur.length > 0 || out.length === 0) out.push(cur);
  }
  return out;
}

export interface HouseOptions {
  /** Stable id used for deterministic tint. */
  ownerId: string;
  /** Display name shown on the plaque above the door. */
  ownerName: string;
  /** World-space anchor — the house's bottom-center sits here. */
  width: number; // visual width in canvas units
  height: number;
  /** Per-station horizontal budget the plaque must fit inside (in
   *  canvas units, post-scale). Used by the §H1 6p layout so a back-row
   *  station's plaque shrinks to match its slot rather than overflowing
   *  into the neighbour or off the canvas edge. The plaque ribbon is
   *  capped at min(stationW * 0.95, generous_default). When omitted the
   *  legacy "max(180, body+pad)" sizing applies — fine for 1..4p but
   *  the caller must supply stationW for 5p/6p. */
  stationW?: number;
}

export class House {
  readonly view: Container;
  private readonly body: Graphics;
  private readonly damage: Graphics;
  /** The name-plaque ribbon. Public so layoutPlayers can re-parent it
   *  into a dedicated overlay layer that paints above all houses — back-
   *  row plaques would otherwise be occluded by front-row roofs. The
   *  plaque is rendered in the house's local pre-scale space, so when
   *  re-parented the layout system must apply (houseX, houseY, scale)
   *  itself; House.draw never touches plaque.position/scale. §H1
   *  (S-437). */
  readonly plaque: Container;
  /** Cached rendered ribbon width (post-fit, in local/pre-scale units).
   *  Set by `draw()` after the shrink loop + clamp. Returned by
   *  `getPlaqueWidth()` so tests + layout assertions can verify the
   *  ribbon never exceeds `stationW` without invoking PixiJS bounds
   *  on the Text child (which requires HTMLCanvasElement.getContext —
   *  not implemented in jsdom). */
  private lastPlaqueW = 0;
  private hp = 100;
  readonly ownerId: string;
  /** Cached opts so resize() can re-draw with the same owner identity
   *  but new geometry (FINAL_GOAL §H1 — narrow viewports need smaller
   *  houses so they don't clip the bottom-sheet). */
  private opts: HouseOptions;

  constructor(opts: HouseOptions) {
    this.ownerId = opts.ownerId;
    this.opts = opts;
    this.view = new Container();
    this.body = new Graphics();
    this.damage = new Graphics();
    this.plaque = new Container();
    this.view.addChild(this.body);
    this.view.addChild(this.damage);
    this.view.addChild(this.plaque);
    this.draw(opts);
  }

  /** Reduce house HP and draw cracks. */
  applyChop(): void {
    this.hp = Math.max(0, this.hp - 25);
    this.redrawDamage();
  }

  reset(): void {
    this.hp = 100;
    this.redrawDamage();
  }

  /** Re-draw with new native dimensions. No-op if dimensions are
   *  unchanged so resize-during-frame callers don't pay redraw cost.
   *  `stationW` is the per-station horizontal budget the plaque must
   *  fit within (canvas units pre-scale). When supplied, the plaque
   *  ribbon is capped at min(stationW * 0.95) so 5p/6p back-row
   *  stations don't bleed into their neighbours. Pre-scale: the
   *  caller (layoutPlayers) divides by `scale` before passing in,
   *  because the plaque is rendered in the house's local space and
   *  scaled by the parent. */
  resize(width: number, height: number, stationW?: number): void {
    const w = Math.max(70, Math.round(width));
    const h = Math.max(80, Math.round(height));
    const sw = stationW !== undefined ? Math.max(50, Math.round(stationW)) : undefined;
    if (
      w === this.opts.width &&
      h === this.opts.height &&
      sw === this.opts.stationW
    ) {
      return;
    }
    this.opts = { ...this.opts, width: w, height: h, stationW: sw };
    this.draw(this.opts);
    this.redrawDamage();
  }

  private redrawDamage(): void {
    const g = this.damage;
    g.clear();
    if (this.hp >= 100) return;
    const cracks = Math.round((100 - this.hp) / 20);
    // jagged dark lines on the front-LEFT iso wall face. Cracks are
    // projected through the same face-local basis the door + windows
    // use: u along (leftBase → frontBase), v straight up. This keeps
    // the cracks visibly anchored to the receding iso wall plane
    // rather than floating in screen space (§K1 iso pass).
    const w = this.opts.width;
    const h = this.opts.height;
    const bodyW = w * 0.78;
    const bodyH = h * 0.55;
    const pW = bodyW / 2 + 8;
    const pH = pW * ISO_SIN;
    const wallH = bodyH;
    const leftBase = { x: -pW, y: 0 };
    const frontBase = { x: 0, y: pH };
    const proj = (u: number, v: number): { x: number; y: number } => {
      const ux = (frontBase.x - leftBase.x) * u;
      const uy = (frontBase.y - leftBase.y) * u;
      return { x: leftBase.x + ux, y: leftBase.y + uy - v };
    };
    for (let i = 0; i < cracks; i++) {
      const u0 = 0.2 + i * 0.13;
      const v0 = wallH * 0.55 - i * wallH * 0.04;
      const points: number[] = [];
      let u = u0;
      let v = v0;
      const p0 = proj(u, v);
      points.push(p0.x, p0.y);
      for (let s = 0; s < 5; s++) {
        u += (i % 2 === 0 ? 0.012 : -0.012) * (1 + s * 0.4);
        v -= wallH * 0.05;
        const p = proj(u, v);
        points.push(p.x, p.y);
      }
      g.poly(points).stroke({ color: 0x1a0000, width: 3 });
    }
  }

  private draw(opts: HouseOptions): void {
    const g = this.body;
    g.clear();
    const w = opts.width;
    const h = opts.height;
    const tint = playerColor(opts.ownerId);

    // Anchor: bottom-center at (0,0). bodyW / bodyH are the *iso footprint
    // generators* — bodyW becomes the plinth diamond's full horizontal
    // span, bodyH becomes the wall height (rise above the plinth top).
    // The legacy bodyX / bodyY (top-left of a flat front-elevation rect)
    // are no longer needed: the iso 3/4 box block below works in iso-
    // diamond corner space (frontBase / rightBase / leftBase / *Top).
    const bodyW = w * 0.78;
    const bodyH = h * 0.55;

    // ===== iso diamond foundation (§K1, S-467) =====
    // Anchor the house onto the iso ground plane with a 2:1 dimetric
    // diamond plinth at y=0. The diamond's width matches the house
    // body's footprint (slight overhang so the wall-base reads as
    // sitting *on* the plinth, not floating above it). The vertical
    // half-height = halfW * ISO_SIN = halfW * 0.5 — exactly the
    // squash ratio used by Ground.ts's iso tiles, so the foundation
    // visually belongs to the same projection as the floor it sits
    // on. Drawn FIRST so the wall-shadow (next call) paints over its
    // back half — the front half remains visible as a base lip,
    // which is the Hades / Stardew "house sits on a tile" cue.
    const plinthHalfW = bodyW / 2 + 8;
    const plinthHalfH = plinthHalfW * ISO_SIN;
    // Plinth top diamond — sits at y = 0 (front corner) → -plinthHalfH (top)
    g.poly([
      0, plinthHalfH,           // front corner (closest to camera)
      plinthHalfW, 0,           // right corner
      0, -plinthHalfH,          // back corner (deepest)
      -plinthHalfW, 0,          // left corner
    ]).fill({ color: palette.houseWallShadow });
    // Lighter highlight on the front-facing half so the diamond reads
    // as a 3-d slab rather than a flat poly. Front-half = front + side
    // corners only.
    g.poly([
      0, plinthHalfH,
      plinthHalfW, 0,
      0, 0,
    ]).fill({ color: palette.houseWall, alpha: 0.55 });
    g.poly([
      0, plinthHalfH,
      -plinthHalfW, 0,
      0, 0,
    ]).fill({ color: palette.houseWall, alpha: 0.4 });
    // Plinth side-skirt: the diamond has a small extruded depth
    // (thickness ~4 px) drawn as two parallelograms hanging beneath
    // the front-left and front-right edges. Sells the "the house
    // is standing on a stone slab" read.
    const skirtH = 4;
    g.poly([
      0, plinthHalfH,
      0, plinthHalfH + skirtH,
      plinthHalfW, skirtH,
      plinthHalfW, 0,
    ]).fill({ color: 0x1a1009 });
    g.poly([
      0, plinthHalfH,
      0, plinthHalfH + skirtH,
      -plinthHalfW, skirtH,
      -plinthHalfW, 0,
    ]).fill({ color: 0x14080a });

    // ===== iso 3/4 box body (§K1, S-497) =====
    //
    // Re-authored from a flat front-elevation rect+triangle (S-467) into
    // a true iso 3/4 box. The body is now drawn through worldToScreen()
    // basis vectors so front-right and front-left wall faces are visibly
    // RECEDING parallelograms (not parallel-vertical), and the roof is
    // a hipped iso roof with two visible slope faces meeting at a ridge
    // apex above the centroid of the top diamond.
    //
    // Local coord system: bottom-center at (0,0). The plinth above
    // defines the footprint diamond. Walls rise straight up by `wallH`
    // pixels (height in screen-y); the top diamond is the same diamond
    // shifted up by wallH. The two visible faces are:
    //
    //   • Front-right face: corners (front_base, right_base, right_top,
    //     front_top). On screen: (0, +pH), (+pW, 0), (+pW, -wallH),
    //     (0, +pH - wallH). Both horizontal edges slope up-right at the
    //     iso angle (pH/pW = ISO_SIN = 0.5), so the face reads as a
    //     parallelogram receding into depth.
    //   • Front-left face: mirror — (left_base, front_base, front_top,
    //     left_top) = (-pW, 0), (0, +pH), (0, +pH - wallH), (-pW, -wallH).
    //
    // The two back faces (right→back, back→left) are hidden behind the
    // front faces, exactly like a Hades / Stardew iso building.
    //
    // Roof: hipped iso roof with a single ridge apex centered above the
    // top diamond's centroid (which is itself at (0, -wallH) since the
    // diamond is symmetric around the local x-axis at y=-wallH). The
    // apex sits at (0, -wallH - roofH). Two visible slope faces:
    //   • Front-right slope: triangle (front_top, right_top, apex)
    //   • Front-left slope: triangle (front_top, left_top, apex)
    // Both slopes are non-axis-aligned triangles — no edge is purely
    // horizontal or vertical — so the roof reads as iso-projected
    // (no head-on isoceles triangle).
    const wallH = bodyH;
    const pW = plinthHalfW;
    const pH = plinthHalfH;
    const frontBase = { x: 0, y: pH };
    const rightBase = { x: pW, y: 0 };
    const leftBase = { x: -pW, y: 0 };
    const frontTop = { x: 0, y: pH - wallH };
    const rightTop = { x: pW, y: -wallH };
    const leftTop = { x: -pW, y: -wallH };

    // Front-RIGHT wall face (the camera-right side, more in shadow).
    g.poly([
      frontBase.x, frontBase.y,
      rightBase.x, rightBase.y,
      rightTop.x, rightTop.y,
      frontTop.x, frontTop.y,
    ]).fill({ color: palette.houseWallShadow });
    // Front-LEFT wall face (the camera-left side, lit — so paint with
    // the lighter wall tone). This is the "primary" face that hosts
    // the door + windows since iso scenes traditionally read better
    // when the door is on the lit face.
    g.poly([
      leftBase.x, leftBase.y,
      frontBase.x, frontBase.y,
      frontTop.x, frontTop.y,
      leftTop.x, leftTop.y,
    ]).fill({ color: palette.houseWall });

    // Roof apex above the centroid of the top diamond.
    const roofH = h * 0.4;
    const apex = { x: 0, y: -wallH - roofH };
    // Front-right roof slope (darker = shadow side).
    g.poly([
      frontTop.x, frontTop.y,
      rightTop.x, rightTop.y,
      apex.x, apex.y,
    ]).fill({ color: palette.houseRoofShadow });
    // Front-left roof slope (tinted by owner — the visible "team color"
    // band, like a flag's house roof in Stardew co-op).
    g.poly([
      leftTop.x, leftTop.y,
      frontTop.x, frontTop.y,
      apex.x, apex.y,
    ]).fill({ color: tint });
    // Roof eave overhang: a thin parallelogram strip at the bottom of
    // each roof slope, extending slightly past the wall edge so the
    // roof visibly overhangs (Stardew's signature eave). Drawn as a
    // narrow poly along each top wall edge, lifted by `eaveDrop`.
    const eaveDrop = 4;
    g.poly([
      frontTop.x, frontTop.y + eaveDrop,
      rightTop.x, rightTop.y + eaveDrop,
      rightTop.x, rightTop.y - 2,
      frontTop.x, frontTop.y - 2,
    ]).fill({ color: palette.houseRoofShadow, alpha: 0.6 });
    g.poly([
      leftTop.x, leftTop.y + eaveDrop,
      frontTop.x, frontTop.y + eaveDrop,
      frontTop.x, frontTop.y - 2,
      leftTop.x, leftTop.y - 2,
    ]).fill({ color: tint, alpha: 0.5 });

    // Ridge highlight: a darker line from the front apex projection
    // down the ridge. Sells the "roof has a ridge" read.
    g.moveTo(apex.x, apex.y);
    g.lineTo(0, pH - wallH); // down to the front-top corner
    g.stroke({ color: palette.houseRoofShadow, width: 2, alpha: 0.8 });

    // Hipped roof horizontal bands (course lines along each slope).
    // Painted on the front-LEFT slope only — the lit slope is where
    // texture detail reads. Each band runs from the left-top edge
    // toward the apex, parallel to the eave.
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      // Interpolate two points: one along (leftTop → apex) and one
      // along (frontTop → apex) at parameter t.
      const px = leftTop.x + (apex.x - leftTop.x) * t;
      const py = leftTop.y + (apex.y - leftTop.y) * t;
      const qx = frontTop.x + (apex.x - frontTop.x) * t;
      const qy = frontTop.y + (apex.y - frontTop.y) * t;
      g.moveTo(px, py);
      g.lineTo(qx, qy);
      g.stroke({ color: palette.houseRoofShadow, width: 1.5, alpha: 0.45 });
    }

    // chimney — sits on the front-right slope, lifted above the roof.
    // Position it at the right-top quarter of the ridge so it pokes
    // out of the visible roof face (not hidden behind it).
    const chimneyBaseX = rightTop.x * 0.45 + frontTop.x * 0.55;
    const chimneyBaseY = rightTop.y * 0.45 + frontTop.y * 0.55 - 2;
    const chimneyW = 14;
    const chimneyH = 28;
    g.rect(chimneyBaseX - chimneyW / 2, chimneyBaseY - chimneyH, chimneyW, chimneyH).fill({ color: palette.houseChimney });
    g.rect(chimneyBaseX - chimneyW / 2 - 2, chimneyBaseY - chimneyH - 4, chimneyW + 4, 6).fill({ color: 0x2a1a14 });

    // ===== door on the front-LEFT wall face =====
    // The door + windows are positioned on the LIT front-left wall poly.
    // To keep them visually attached to the iso-skewed face, we project
    // them in the face's local 2D basis: u-axis runs along the bottom
    // edge (from leftBase → frontBase), v-axis runs straight up. A door
    // centered on the face at (u=0.5, v=0) of width=doorW maps to a
    // small parallelogram on screen, not an axis-aligned rect.
    const faceProject = (
      anchorBase: { x: number; y: number },
      otherBase: { x: number; y: number },
      u: number,
      v: number,
    ): { x: number; y: number } => {
      const ux = (otherBase.x - anchorBase.x) * u;
      const uy = (otherBase.y - anchorBase.y) * u;
      return {
        x: anchorBase.x + ux,
        y: anchorBase.y + uy - v,
      };
    };
    // Door dimensions in face-local units. uHalf = 0.11 (door is ~22%
    // of the face width). vBottom = 4 (lift just above ground), vTop =
    // wallH * 0.55 (door is 55% of wall height).
    const doorUHalf = 0.11;
    const doorVBot = 4;
    const doorVTop = wallH * 0.55;
    const dBL = faceProject(leftBase, frontBase, 0.5 - doorUHalf, doorVBot);
    const dBR = faceProject(leftBase, frontBase, 0.5 + doorUHalf, doorVBot);
    const dTR = faceProject(leftBase, frontBase, 0.5 + doorUHalf, doorVTop);
    const dTL = faceProject(leftBase, frontBase, 0.5 - doorUHalf, doorVTop);
    // Door frame (slightly larger).
    const fBL = faceProject(leftBase, frontBase, 0.5 - doorUHalf - 0.015, doorVBot - 2);
    const fBR = faceProject(leftBase, frontBase, 0.5 + doorUHalf + 0.015, doorVBot - 2);
    const fTR = faceProject(leftBase, frontBase, 0.5 + doorUHalf + 0.015, doorVTop + 4);
    const fTL = faceProject(leftBase, frontBase, 0.5 - doorUHalf - 0.015, doorVTop + 4);
    g.poly([fBL.x, fBL.y, fBR.x, fBR.y, fTR.x, fTR.y, fTL.x, fTL.y]).fill({ color: palette.houseDoorFrame });
    g.poly([dBL.x, dBL.y, dBR.x, dBR.y, dTR.x, dTR.y, dTL.x, dTL.y]).fill({ color: palette.houseDoor });
    // Door cross-plank (mid-height stripe).
    const cBL = faceProject(leftBase, frontBase, 0.5 - doorUHalf + 0.005, doorVTop * 0.5 - 1);
    const cBR = faceProject(leftBase, frontBase, 0.5 + doorUHalf - 0.005, doorVTop * 0.5 - 1);
    const cTR = faceProject(leftBase, frontBase, 0.5 + doorUHalf - 0.005, doorVTop * 0.5 + 1);
    const cTL = faceProject(leftBase, frontBase, 0.5 - doorUHalf + 0.005, doorVTop * 0.5 + 1);
    g.poly([cBL.x, cBL.y, cBR.x, cBR.y, cTR.x, cTR.y, cTL.x, cTL.y]).fill({ color: palette.houseDoorFrame });
    // Door knob — small dot at the right side of the door at half height.
    const knob = faceProject(leftBase, frontBase, 0.5 + doorUHalf - 0.018, doorVTop * 0.55);
    g.circle(knob.x, knob.y, 2.5).fill({ color: palette.uiGold });

    // ===== two windows flanking the door on the front-LEFT face =====
    const winUHalf = 0.08;
    const winVBot = wallH * 0.62;
    const winVTop = wallH * 0.84;
    const drawWindow = (uCenter: number): void => {
      const fBL2 = faceProject(leftBase, frontBase, uCenter - winUHalf - 0.012, winVBot - 3);
      const fBR2 = faceProject(leftBase, frontBase, uCenter + winUHalf + 0.012, winVBot - 3);
      const fTR2 = faceProject(leftBase, frontBase, uCenter + winUHalf + 0.012, winVTop + 3);
      const fTL2 = faceProject(leftBase, frontBase, uCenter - winUHalf - 0.012, winVTop + 3);
      g.poly([fBL2.x, fBL2.y, fBR2.x, fBR2.y, fTR2.x, fTR2.y, fTL2.x, fTL2.y]).fill({ color: palette.houseWindowFrame });
      const wBL = faceProject(leftBase, frontBase, uCenter - winUHalf, winVBot);
      const wBR = faceProject(leftBase, frontBase, uCenter + winUHalf, winVBot);
      const wTR = faceProject(leftBase, frontBase, uCenter + winUHalf, winVTop);
      const wTL = faceProject(leftBase, frontBase, uCenter - winUHalf, winVTop);
      g.poly([wBL.x, wBL.y, wBR.x, wBR.y, wTR.x, wTR.y, wTL.x, wTL.y]).fill({ color: palette.houseWindow });
      // Vertical mullion.
      const mBot = faceProject(leftBase, frontBase, uCenter - 0.003, winVBot);
      const mTop = faceProject(leftBase, frontBase, uCenter + 0.003, winVTop);
      const mBot2 = faceProject(leftBase, frontBase, uCenter + 0.003, winVBot);
      const mTop2 = faceProject(leftBase, frontBase, uCenter - 0.003, winVTop);
      g.poly([mBot.x, mBot.y, mBot2.x, mBot2.y, mTop.x, mTop.y, mTop2.x, mTop2.y]).fill({ color: palette.houseWindowFrame });
      // Horizontal sash.
      const sMid = (winVBot + winVTop) / 2;
      const sBL = faceProject(leftBase, frontBase, uCenter - winUHalf, sMid - 1);
      const sBR = faceProject(leftBase, frontBase, uCenter + winUHalf, sMid - 1);
      const sTR = faceProject(leftBase, frontBase, uCenter + winUHalf, sMid + 1);
      const sTL = faceProject(leftBase, frontBase, uCenter - winUHalf, sMid + 1);
      g.poly([sBL.x, sBL.y, sBR.x, sBR.y, sTR.x, sTR.y, sTL.x, sTL.y]).fill({ color: palette.houseWindowFrame });
    };
    drawWindow(0.25);
    drawWindow(0.75);

    // Ground stoop — a small iso-projected step in front of the door,
    // sitting on the plinth top.
    const stoopBL = faceProject(leftBase, frontBase, 0.5 - doorUHalf - 0.04, -2);
    const stoopBR = faceProject(leftBase, frontBase, 0.5 + doorUHalf + 0.04, -2);
    const stoopFR = { x: stoopBR.x + 4, y: stoopBR.y + 4 * ISO_SIN + 4 };
    const stoopFL = { x: stoopBL.x - 4, y: stoopBL.y - 4 * ISO_SIN + 4 };
    g.poly([stoopBL.x, stoopBL.y, stoopBR.x, stoopBR.y, stoopFR.x, stoopFR.y, stoopFL.x, stoopFL.y]).fill({ color: 0x4a3424 });

    // name plaque — width auto-sized to the rendered nameplate so long
    // strategy names ('counter', 'random', 'mirror', 'counter#2') do
    // not truncate. The plaque hangs above the roof. We measure the
    // text width using a fresh OffscreenCanvas 2D context, BUT — and
    // this is the §H1 fix — we never let the plaque cap fall below
    // the measured text width. The previous code capped the plaque
    // at `houseW * 0.78 + 32` which on a narrow back-row 6p slot
    // (houseW=200, cap=188) was technically wide enough for
    // 'counter' (~85px), but the OffscreenCanvas measureText returns
    // a slightly UNDERSIZED width when the @font-face PingFang SC
    // hasn't loaded yet, so the plaque ended up ribbon-width ≈ 117
    // and Pixi rendered the dark-on-dark 'r' OUTSIDE the ribbon
    // (invisible against the night sky). Now we use a generous +56
    // safety pad and a higher floor so the visible ribbon ALWAYS
    // covers the rendered glyph run.
    //
    // §H1 (S-438): the S-437 hard-clamp clamped the RIBBON width to
    // the slot but left the rasterized Pixi.Text natural-width
    // unbounded, so on narrow 6p × 375 back-row slots the bold-700
    // PingFang SC fallback overshot the ribbon and the rendered
    // glyph run extended past the slot edge — visible as plaque
    // text spilling off the canvas-right edge ('counter#2' → 'ter#2'
    // off-canvas) and invading the canvas-left band ('玩家91' →
    // '玩...' clipped). Fix: enable Pixi's `wordWrap: true` +
    // `breakWords: true` with `wordWrapWidth = renderableTextW` so
    // the rasterized texture is hard-bounded to the slot. Long
    // displayNames wrap to a 2nd line ('counter#2' →
    // 'counter\n#2') instead of overflowing horizontally; Pixi.Text
    // .text remains exactly equal to bot.displayName (no ellipsis,
    // no truncation), satisfying the acceptance contract.
    this.plaque.removeChildren();
    // Plaque sits above the roof apex. With the iso 3/4 box, the apex
    // is at (0, -wallH - roofH); add a 32-px clearance above it for
    // the ribbon. Equivalent to the prior `roofTop - 32` formula —
    // the apex is now the visible top of the silhouette.
    const plaqueY = -wallH - roofH - 32;
    const namePool = opts.ownerName ?? '';
    const fontFamily =
      'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
    const measureCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(8, 8)
        : (typeof document !== 'undefined' ? document.createElement('canvas') : null);
    const measureCtx = measureCanvas?.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
      | undefined;
    // Per-char heuristic that matches what Pixi *actually* renders in
    // the fallback PingFang-SC stack on first paint — used both as the
    // jsdom test fallback AND as a floor for browser measurement,
    // because the browser canvas measureText returns ~0.7em per Latin
    // glyph but Pixi's bold-weight render emits ~0.95em per Latin
    // glyph in fallback (no PingFang loaded yet). §H1 — without this
    // floor, fontSize never shrinks enough on a narrow 6p back-row
    // station and 'counter' / 'counter#2' overflow the plaque ribbon.
    const heuristicTextW = (str: string, fs: number): number => {
      // §H1 (S-401 / iter-49): coefficients calibrated to match what
      // CanvasTextMetrics.measureText returns in the live browser for
      // bold-700 PingFang-SC fallback. Bold Latin advances ~0.62 em
      // for monospace digits / lowercase, but capital letters / CJK
      // run wider; we use 0.70 for Latin (gives ~10% headroom over
      // canvas2d's 0.62) and 1.05 for CJK. This is only the *jsdom
      // fallback* path — the live path uses CanvasTextMetrics directly.
      let t = 0;
      for (const ch of str) {
        const code = ch.charCodeAt(0);
        const cjk =
          (code >= 0x3000 && code <= 0x9fff) ||
          (code >= 0xff00 && code <= 0xffef);
        t += cjk ? fs * 1.05 : fs * 0.70;
      }
      return Math.ceil(t);
    };
    const measureTextW = (str: string, fs: number): number => {
      const heur = heuristicTextW(str, fs);
      if (!measureCtx) return heur;
      measureCtx.font = `700 ${fs}px ${fontFamily}`;
      const m = Math.ceil(measureCtx.measureText(str).width);
      return Math.max(m, heur);
    };
    // §H1 (S-401 / iter-49): use Pixi's CanvasTextMetrics.measureText
    // to get the *truthful* glyph-run width from the same code path
    // that Pixi.Text will eventually rasterize through. This avoids
    // the Pixi 8 lazy-measure trap (Text.width returns 0 until the
    // first render) and the heuristic-overestimate trap (1.10 em was
    // both wrong in absolute terms AND too pessimistic against
    // modest-budget back-row slots).
    //
    // Two-pass: first measure at fontSize=16, then if `safetyW + 16`
    // exceeds the station budget, shrink fontSize 1 px at a time
    // until it fits or we hit floor=7. The ribbon width is then
    // sized to the *post-shrink* measureText result so it always
    // covers the rendered glyph run with no truncation.
    // §H1 (S-438): when `wrapW` is positive the TextStyle requests
    // word-wrap (with breakWords=true so single-token names like
    // 'counter#2' break at character boundaries). When wrapW is 0
    // we render single-line — the only callers that pass 0 are the
    // shrink-loop measurement passes that need the natural advance.
    const buildStyle = (fs: number, wrapW = 0): TextStyle =>
      new TextStyle({
        fontFamily,
        fontSize: fs,
        fontWeight: '700',
        fill: 0x2a1a14,
        // §H1 (S-401 / iter-49): Pixi 8 default padding=0 clips the
        // rightmost glyph's bearing for bold-700 fontFamily fallbacks
        // ('counter#2' rasterized as 'counter#'). Bump to 8 px so the
        // texture canvas covers the full rasterized run including the
        // trailing bearing on any font fallback.
        padding: 8,
        align: 'center',
        ...(wrapW > 0
          ? {
              wordWrap: true,
              wordWrapWidth: wrapW,
              breakWords: true,
              lineHeight: Math.ceil(fs * 1.15),
            }
          : {}),
      });
    const measurePixiTextW = (str: string, fs: number): number => {
      try {
        const m = CanvasTextMetrics.measureText(str, buildStyle(fs));
        const mw = (m as { width?: number }).width;
        if (Number.isFinite(mw) && (mw as number) > 0) {
          return Math.ceil(mw as number);
        }
      } catch {
        /* fallthrough — jsdom path */
      }
      // Fallback for jsdom / no-canvas environments: max of
      // canvas2d measureText and the heuristic-1.10em floor.
      const heur = heuristicTextW(str, fs);
      const m2 = measureTextW(str, fs);
      return Math.max(heur, m2);
    };

    // Plaque cap. With a station budget (5p/6p layouts where
    // adjacent plaques must not overlap), use stationW * 0.95 as the
    // SOFT upper bound. Without, fall back to a generous body-
    // relative cap so 1..4p layouts get chunky readable plaques.
    const stationCap =
      opts.stationW !== undefined
        ? Math.max(50, opts.stationW * 0.95)
        : Number.POSITIVE_INFINITY;
    const cap = Math.min(stationCap, Math.max(200, w * 0.78 + 64));

    // §H1 (S-442) — Font floor raised back to 9 (legibility floor).
    // Previous S-440 lowered the floor to 4 to keep long names like
    // 'counter#2' single-line within a clamped 30-px slot; that fit
    // the bounds but rendered the text as illegible 4-px glyph soup.
    // Acceptance now requires fontSize ≥ 9 px for every plaque on
    // the worst-case 6p × 375 mobile layout. We achieve that by:
    //
    //   1. Picking the LARGEST fontSize ∈ [9, 16] whose SINGLE-CHAR
    //      width fits inside the wrap area (so wordWrap+breakWords
    //      can always make at least 1-char-per-line progress). For
    //      any non-degenerate slot (≥ 30 px) and CJK at fontSize=9
    //      (~9.45 px), this lands at fs=16 except for the worst-case
    //      clamped 40-px slot, where larger fontSizes' single-char
    //      widths exceed the inner-content area.
    //   2. Letting wordWrap+breakWords spread the displayName across
    //      as many lines as needed (ribbon height grows with line
    //      count via the wrappedLines.length × lineH formula below).
    //
    // The shrink loop now uses the *single widest char* width (not
    // the natural-advance natural width) as the fit constraint, and
    // floors at 9 instead of 4. If even the single widest char
    // can't fit inside the available wrap width at fontSize=9, the
    // floor stays at 9 (we accept that the rasterized glyph may
    // touch the ribbon edge — wordWrap still emits a single char
    // per line, so the texture cannot exceed the ribbon horizontally
    // by more than the 8-px PLAQUE_TEXT_PAD already accounted for).
    // §H1 (S-447) — segment-aware longest-token measurement. The
    // shrink loop below shrinks fontSize until the LONGEST INDIVIDUAL
    // word-token (the units our wrapTextToWidth refuses to break
    // mid-character) fits inside the wrap budget. For 'counter#2'
    // tokenized as ['counter', '#', '2'], the longest token is
    // 'counter' (7 chars). For '玩家72' tokenized as ['玩','家','7','2']
    // (CJK each-own, Latin clustered into '72'), the longest is '72'
    // — but at the smallest CJK widths so this floors gracefully.
    //
    // We use the inflated measure (matches the eventual wrap budget)
    // so the shrink decision lines up with the wrap decision.
    const FONT_FALLBACK_INFLATION = 1.2;
    const measureInflated = (s: string, fs: number): number =>
      Math.ceil(measurePixiTextW(s, fs) * FONT_FALLBACK_INFLATION);
    const isWordChar = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
    const isCJKChar = (ch: string): boolean => {
      const code = ch.charCodeAt(0);
      return (
        (code >= 0x3000 && code <= 0x9fff) ||
        (code >= 0xff00 && code <= 0xffef)
      );
    };
    const tokenize = (str: string): string[] => {
      const out: string[] = [];
      let buf = '';
      for (const ch of str) {
        if (isCJKChar(ch) || !isWordChar(ch)) {
          if (buf.length > 0) {
            out.push(buf);
            buf = '';
          }
          out.push(ch);
        } else {
          buf += ch;
        }
      }
      if (buf.length > 0) out.push(buf);
      return out;
    };
    const longestTokenW = (str: string, fs: number): number => {
      let max = 0;
      for (const tok of tokenize(str)) {
        const w = measureInflated(tok, fs);
        if (w > max) max = w;
      }
      return max;
    };
    let fontSize = 16;
    // The wrap area available to the rasterized text. Must match the
    // `wrapW` derivation below: ribbon width minus 2× TEXT_FIT_PAD
    // (8 px each side, the Pixi TextStyle `padding: 8` rasterization
    // overshoot). With this margin, the RASTERIZED texture (which is
    // glyph advance + 16 px) fits inside the visible ribbon — fixing
    // the §H1 (S-443) desktop 'counter#2' → 'counter#?' truncation
    // where wrapW = plaqueW - 12 was just barely wide enough that
    // Pixi did NOT wrap (advance ~100 px ≤ wrapW ~103 px) but the
    // texture (~116 px) overshot the 115-px ribbon and the trailing
    // glyph rendered onto the dark canvas background outside the
    // lighter ribbon — visually a "truncation" though the .text was
    // intact. wrapBudget is the worst-case (slot-cap) wrap width
    // used by the fontSize-shrink loop.
    const TEXT_FIT_PAD = 8;
    const PADDING_GUARD = 4;
    const wrapBudget = (): number => {
      return Math.max(8, cap - 2 * TEXT_FIT_PAD - 2 * PADDING_GUARD);
    };
    // §H1 (S-447) two-stage shrink:
    //   Stage 1 (preferred): shrink until the longest token fits
    //   inside wrapBudget at fontSize ≥ 9. If we hit that, the
    //   wrapTextToWidth call below will produce one line (or a
    //   line-per-CJK-char) with NO mid-word break.
    //   Stage 2 (fallback): if even at fs=9 the longest token still
    //   exceeds the budget, drop the floor to 6 — better small-but-
    //   readable text than a mid-word break.
    while (
      longestTokenW(namePool, fontSize) > wrapBudget() &&
      fontSize > 9
    ) {
      fontSize -= 1;
    }
    while (
      longestTokenW(namePool, fontSize) > wrapBudget() &&
      fontSize > 6
    ) {
      fontSize -= 1;
    }
    // Final rendered glyph-run width at the chosen fontSize. The
    // TextStyle `padding: 8` set above ensures Pixi's rasterization
    // texture extends 8 px past the advance on each side, so the
    // rightmost glyph's bearing is never clipped — this was the
    // 'counter#2' → 'counter#' truncation bug observed live (S-401
    // / iter-49). The renderedW formula adds 24 px (12 each side)
    // to the raw advance — enough to cover the rasterization padding
    // plus a small visible inset between text and ribbon edge.
    const measuredW = measurePixiTextW(namePool, fontSize);
    const renderedW = Math.ceil(measuredW) + 24;

    // §H1 (S-438) — Ribbon width derivation.
    //
    // We commit a final plaqueW THEN build the Pixi.Text with
    // `wordWrap: true, wordWrapWidth = plaqueW - 2*innerPad,
    // breakWords: true` so the rasterized texture is hard-bounded
    // to the slot. Any displayName whose natural advance at the
    // chosen fontSize would overflow the slot wraps to a 2nd line
    // (e.g. 'counter#2' becomes 'counter\n#2') and Pixi.Text.text
    // remains exactly === bot.displayName (no ellipsis, no
    // truncation). The ribbon height grows with the rendered line
    // count so the wrapped text stays inside the dark backdrop.
    //
    // Ribbon width policy:
    //   • stationW supplied (5p/6p layouts): hard-clamp to the slot
    //     budget so adjacent plaques never overlap and the outermost
    //     plaque never extends past the canvas edge. Acceptance:
    //     plaqueCanvasW ≤ stationW (the §H1 guard).
    //   • stationW omitted (1..4p layouts): use the natural rendered
    //     width with a generous floor of 180 px so legacy chunky
    //     plaques still read.
    const padPerSide = 8;
    const minRibbon = renderedW + 2 * padPerSide;
    let plaqueW: number;
    if (opts.stationW !== undefined) {
      const slotCap = Math.max(40, opts.stationW);
      plaqueW = Math.min(minRibbon, slotCap);
    } else {
      plaqueW = Math.max(180, minRibbon);
    }

    // wordWrapWidth: subtract 2× TEXT_FIT_PAD so the rasterized
    // texture (glyph advance + 2× Pixi TextStyle padding) fits inside
    // the visible ribbon. §H1 (S-443) — fixes the desktop 'counter#2'
    // truncation where the previous wrapW = plaqueW - 12 left only
    // 6 px of margin per side, less than Pixi's 8-px texture overshoot,
    // so on a 115-px ribbon the trailing '2' rasterized at x≈[100, 116]
    // and ended up painted on the dark canvas background past the
    // ribbon's right edge (visually invisible / "counter#?").
    const wrapW = Math.max(20, plaqueW - 2 * TEXT_FIT_PAD);

    // §H1 (S-445) — pre-wrap the text ourselves and pass the multi-
    // line string to Pixi with wordWrap DISABLED. The S-443 fix relied
    // on Pixi's own wordWrap+breakWords to wrap long unbroken tokens
    // like 'counter#2' when their measured advance exceeded
    // wordWrapWidth. Live verdict iter74: at desktop canvas 776×616
    // slot 5 (rightmost front-row, plaqueW≈115 px, wrapW≈99 px),
    // Pixi's measureText returned a single-line advance just under
    // wrapW so wordWrap did NOT trigger — but the rasterized texture
    // (advance + 16 px Pixi padding) still overshot the visible
    // ribbon by a few pixels, clipping the trailing '2' glyph
    // (visually 'counter#?').
    //
    // Root cause: the only thing wrapW guards is Pixi's wrap
    // *decision*, not the texture footprint. Pixi's wrap and the
    // texture footprint use the same measureText, but the texture
    // adds 2*padding on top of the measured advance — so for an
    // advance value within (wrapW - padding*2, wrapW] the texture
    // overflows the ribbon while wrap stays inactive.
    //
    // S-445 fix: do the wrap *ourselves* using the same
    // measurePixiTextW (which calls Pixi's CanvasTextMetrics
    // measureText so the measurement is on the same code path Pixi
    // would use during render). The wrap criterion now is
    // 'measured advance + 2*padding ≤ plaqueW' — i.e. the texture
    // (not just the advance) must fit the ribbon. We then pass the
    // pre-wrapped multi-line string to Pixi as `wrappedText` with
    // wordWrap disabled, so the layout is fully deterministic and
    // independent of Pixi's wordWrap quirks. The text node's .text
    // becomes 'counter#\n2' (or 'coun\nter#2' for tighter slots),
    // matching the S-445 acceptance contract verbatim.
    //
    // wrapTextToWidth uses `wrapW - 2*PADDING_GUARD` as the per-line
    // budget so even with measurement drift between jsdom heuristic
    // and live Pixi advance, the rasterized texture stays inside
    // the ribbon with ≥ 4 px slack on each side. PADDING_GUARD and
    // measureInflated (with FONT_FALLBACK_INFLATION = 1.2) were
    // hoisted above the shrink loop in S-447 so the shrink decision
    // and the wrap decision share the same advance measurement.
    const lineBudget = Math.max(8, wrapW - 2 * PADDING_GUARD);
    // §H1 (S-447) — token-aware wrapTextToWidth. Tokenizes the name
    // into CJK-each-own / Latin-word-clustered / punctuation-each-own
    // tokens and greedy-fits whole tokens onto each line. NEVER
    // breaks mid-Latin-word: 'counter#2' becomes 'counter#\n2' (or
    // 'counter\n#2' / 'counter#2' depending on budget) but never
    // 'co/unter/#2' (the iter77 §H1 mid-word regression).
    let wrappedLines = wrapTextToWidth(namePool, lineBudget, fontSize, measureInflated);
    // §H1 (S-447) — last-resort ellipsis when even at the lowered
    // fontSize floor of 6 the longest token still exceeds lineBudget.
    // The acceptance brief explicitly prefers single-ellipsis
    // truncation ('cou…#2') to a mid-word wrap.
    const overflowing = wrappedLines.some(
      (line) => measureInflated(line, fontSize) > lineBudget,
    );
    if (overflowing) {
      // Strategy: keep the FIRST token in full, replace overflowing
      // tail tokens with '…'. This preserves the most identifying
      // chars (the start of the name) while giving the user a clear
      // visual cue that more text exists beyond the ellipsis.
      const tokens = tokenize(namePool);
      let acc = '';
      let head = '';
      for (const tok of tokens) {
        const tentative = acc + tok + '…';
        if (measureInflated(tentative, fontSize) <= lineBudget) {
          acc += tok;
          head = acc;
        } else {
          break;
        }
      }
      // Edge case: not even the first token + '…' fits. Drop chars
      // off the head until 'X…' fits, where X is at least one char.
      if (head.length === 0) {
        // Take prefix chars from the first token until they + '…' fit.
        const firstTok = tokens[0] ?? namePool;
        let prefix = '';
        for (const ch of firstTok) {
          const tentative = prefix + ch + '…';
          if (measureInflated(tentative, fontSize) <= lineBudget) {
            prefix += ch;
          } else {
            break;
          }
        }
        // Guarantee at least one char + '…' even if the budget is
        // pathologically small; the layout's edge clamp ensures the
        // plaque ribbon is at least 40 px so this branch fits.
        if (prefix.length === 0 && firstTok.length > 0) {
          prefix = firstTok[0]!;
        }
        head = prefix;
      }
      wrappedLines = [head + '…'];
    }
    const wrappedText = wrappedLines.join('\n');
    const lineH = Math.ceil(fontSize * 1.15);
    // Ribbon height: enough to host every wrapped line plus 8 px
    // top/bottom inset. Floor of 28 keeps single-line plaques the
    // same height as before so 1..4p layouts visually unchanged.
    const plaqueH = Math.max(28, wrappedLines.length * lineH + 12);
    const text = new Text({
      text: wrappedText,
      // wordWrap explicitly OFF — the text already contains the
      // \n line breaks computed above, so Pixi just renders each
      // pre-split line at its natural width. This removes Pixi's
      // wordWrap-vs-texture mismatch as a source of overflow.
      style: buildStyle(fontSize, 0),
    });
    text.anchor.set(0.5);
    text.position.set(0, plaqueY + plaqueH / 2);

    const plaqueG = new Graphics();
    plaqueG.rect(-plaqueW / 2 - 2, plaqueY - 2, plaqueW + 4, plaqueH + 4).fill({ color: 0x2a1a14 });
    plaqueG.rect(-plaqueW / 2, plaqueY, plaqueW, plaqueH).fill({ color: palette.housePlaque });
    // little hanger ribbons
    plaqueG.rect(-6, plaqueY - 8, 12, 6).fill({ color: palette.houseRoof });
    this.plaque.addChild(plaqueG);
    this.plaque.addChild(text);
    // Cache for getPlaqueWidth(); see field comment above.
    this.lastPlaqueW = plaqueW;
  }

  /** Read the rendered plaque ribbon width (post-fit). Used by tests +
   *  multi-room layout assertions to verify nameplates aren't truncated. */
  getPlaqueWidth(): number {
    return this.lastPlaqueW;
  }
}
