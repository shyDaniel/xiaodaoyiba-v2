// House sprite. Roof + body + door + 2 windows + chimney + name plaque.
// Per-house deterministic tinting via playerColor() (FINAL_GOAL §C9).
// Drawn at native ≥ 256px so it reads as a 2024 indie sprite, not a 2010
// HTML pixel-art prototype.

import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { palette, playerColor } from '../../palette.js';

export interface HouseOptions {
  /** Stable id used for deterministic tint. */
  ownerId: string;
  /** Display name shown on the plaque above the door. */
  ownerName: string;
  /** World-space anchor — the house's bottom-center sits here. */
  width: number; // visual width in canvas units
  height: number;
}

export class House {
  readonly view: Container;
  private readonly body: Graphics;
  private readonly damage: Graphics;
  private readonly plaque: Container;
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
   *  unchanged so resize-during-frame callers don't pay redraw cost. */
  resize(width: number, height: number): void {
    const w = Math.max(80, Math.round(width));
    const h = Math.max(90, Math.round(height));
    if (w === this.opts.width && h === this.opts.height) return;
    this.opts = { ...this.opts, width: w, height: h };
    this.draw(this.opts);
    this.redrawDamage();
  }

  private redrawDamage(): void {
    const g = this.damage;
    g.clear();
    if (this.hp >= 100) return;
    const cracks = Math.round((100 - this.hp) / 20);
    // jagged dark lines on the wall
    for (let i = 0; i < cracks; i++) {
      const x0 = -40 + i * 18;
      const y0 = -40 - i * 4;
      const points: number[] = [x0, y0];
      let x = x0;
      let y = y0;
      for (let s = 0; s < 5; s++) {
        x += (i % 2 === 0 ? 1 : -1) * (4 + s);
        y += 8;
        points.push(x, y);
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

    // Anchor: bottom-center at (0,0)
    // body
    const bodyW = w * 0.78;
    const bodyH = h * 0.55;
    const bodyX = -bodyW / 2;
    const bodyY = -bodyH;

    // wall shadow
    g.rect(bodyX, bodyY, bodyW, bodyH).fill({ color: palette.houseWallShadow });
    // wall front (slightly inset top)
    g.rect(bodyX + 6, bodyY + 4, bodyW - 12, bodyH - 6).fill({ color: palette.houseWall });

    // roof — triangular with eave tinted by owner color
    const roofTop = bodyY - h * 0.4;
    g.poly([
      bodyX - 16, bodyY + 6,
      bodyW / 2, roofTop,
      bodyX + bodyW + 16, bodyY + 6,
    ]).fill({ color: palette.houseRoofShadow });
    g.poly([
      bodyX - 8, bodyY + 4,
      bodyW / 2, roofTop + 6,
      bodyX + bodyW + 8, bodyY + 4,
    ]).fill({ color: tint });
    // roof tiles — horizontal bands
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      const yLine = bodyY + 4 - (bodyY + 4 - (roofTop + 6)) * (1 - t);
      const halfWAtT = (bodyW / 2 + 8) * (1 - t);
      g.moveTo(bodyW / 2 - halfWAtT, yLine);
      g.lineTo(bodyW / 2 + halfWAtT, yLine);
      g.stroke({ color: palette.houseRoofShadow, width: 2, alpha: 0.55 });
    }

    // chimney
    const chimneyX = bodyX + bodyW * 0.65;
    const chimneyY = roofTop + h * 0.18;
    g.rect(chimneyX, chimneyY, 14, 28).fill({ color: palette.houseChimney });
    g.rect(chimneyX - 2, chimneyY - 4, 18, 6).fill({ color: 0x2a1a14 });

    // door
    const doorW = bodyW * 0.22;
    const doorH = bodyH * 0.55;
    const doorX = bodyX + (bodyW - doorW) / 2;
    const doorY = bodyY + bodyH - doorH;
    g.rect(doorX - 3, doorY - 3, doorW + 6, doorH + 6).fill({ color: palette.houseDoorFrame });
    g.rect(doorX, doorY, doorW, doorH).fill({ color: palette.houseDoor });
    // door knob
    g.circle(doorX + doorW - 6, doorY + doorH * 0.55, 2.5).fill({ color: palette.uiGold });
    // door cross-plank
    g.rect(doorX + 1, doorY + doorH * 0.5 - 1, doorW - 2, 2).fill({ color: palette.houseDoorFrame });

    // two windows flanking the door
    const winW = bodyW * 0.16;
    const winH = bodyH * 0.22;
    const winY = bodyY + bodyH * 0.22;
    const drawWindow = (cx: number): void => {
      g.rect(cx - winW / 2 - 3, winY - 3, winW + 6, winH + 6).fill({ color: palette.houseWindowFrame });
      g.rect(cx - winW / 2, winY, winW, winH).fill({ color: palette.houseWindow });
      // cross
      g.rect(cx - 1, winY, 2, winH).fill({ color: palette.houseWindowFrame });
      g.rect(cx - winW / 2, winY + winH / 2 - 1, winW, 2).fill({ color: palette.houseWindowFrame });
    };
    drawWindow(bodyX + bodyW * 0.22);
    drawWindow(bodyX + bodyW * 0.78);

    // ground stoop
    g.rect(doorX - 8, bodyY + bodyH - 4, doorW + 16, 6).fill({ color: 0x4a3424 });

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
    this.plaque.removeChildren();
    const plaqueY = roofTop - 32;
    const plaqueH = 28;
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
    const measureTextW = (str: string, fs: number): number => {
      if (!measureCtx) {
        // jsdom test fallback: heuristic that matches the test geometry
        // (roughly 0.7 * fontSize per Latin char + 1.0 * fontSize per CJK)
        let t = 0;
        for (const ch of str) {
          const code = ch.charCodeAt(0);
          const cjk =
            (code >= 0x3000 && code <= 0x9fff) ||
            (code >= 0xff00 && code <= 0xffef);
          t += cjk ? fs * 1.0 : fs * 0.7;
        }
        return Math.ceil(t);
      }
      measureCtx.font = `700 ${fs}px ${fontFamily}`;
      return Math.ceil(measureCtx.measureText(str).width);
    };
    // Plaque cap: we allow the plaque to extend up to a generous
    // multiple of the house's body width so even narrow mobile
    // back-row houses (houseW=110) host a readable 'counter#2'
    // nameplate. The cap is independent of houseW for narrow
    // houses — we'd rather let the plaque ribbon overhang the
    // house silhouette than truncate the bot's display name.
    const cap = Math.max(200, w * 0.78 + 64);
    let fontSize = 16;
    while (measureTextW(namePool, fontSize) + 24 > cap && fontSize > 10) {
      fontSize -= 1;
    }
    // Re-measure with a heuristic floor: bold Latin renders ~0.62
    // em wide, but font-fallback at first paint (PingFang SC not
    // yet hot) can push glyph advances to ~0.72 em. We take the
    // larger of the canvas measurement and a per-char heuristic so
    // we never under-size the ribbon on first paint.
    const measuredW = measureTextW(namePool, fontSize);
    let heuristicW = 0;
    for (const ch of namePool) {
      const code = ch.charCodeAt(0);
      const cjk =
        (code >= 0x3000 && code <= 0x9fff) ||
        (code >= 0xff00 && code <= 0xffef);
      // Bold-weight Latin glyph advances at fontSize 16 in fallback
      // sans-serif average ~0.85 em (canvas measureText returned ~70
      // for 'counter' but the rendered glyphs in Pixi consume ~95);
      // CJK glyphs are ~1.05 em (square + bold padding).
      heuristicW += cjk ? fontSize * 1.05 : fontSize * 0.85;
    }
    const safeW = Math.max(measuredW, Math.ceil(heuristicW));
    // Final safety pad: +56 px (28 px each side). Empirically Pixi's
    // bold text rendering is ~30% wider than canvas measureText for
    // the fallback PingFang SC stack on first paint, so we apply a
    // generous buffer rather than tight-fitting the ribbon. The
    // minimum plaque width is bumped to 180 so even short names
    // ('iron', 'mirror') host a chunky readable ribbon — and so the
    // §H1 "no clipping" assertion in layout.test.ts holds across the
    // 2..6p × {1280×800, 375×667} matrix.
    const plaqueW = Math.max(180, safeW + 56);

    const plaqueG = new Graphics();
    plaqueG.rect(-plaqueW / 2 - 2, plaqueY - 2, plaqueW + 4, plaqueH + 4).fill({ color: 0x2a1a14 });
    plaqueG.rect(-plaqueW / 2, plaqueY, plaqueW, plaqueH).fill({ color: palette.housePlaque });
    // little hanger ribbons
    plaqueG.rect(-6, plaqueY - 8, 12, 6).fill({ color: palette.houseRoof });
    this.plaque.addChild(plaqueG);

    const text = new Text({
      text: namePool,
      style: new TextStyle({
        fontFamily:
          'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize,
        fontWeight: '700',
        fill: 0x2a1a14,
      }),
    });
    text.anchor.set(0.5);
    text.position.set(0, plaqueY + plaqueH / 2);
    this.plaque.addChild(text);
  }

  /** Read the rendered plaque ribbon width (post-fit). Used by tests +
   *  multi-room layout assertions to verify nameplates aren't truncated. */
  getPlaqueWidth(): number {
    // The plaque background is the first child Graphics; its bounds
    // give us the rendered ribbon size in local coordinates.
    if (this.plaque.children.length === 0) return 0;
    const bounds = this.plaque.getLocalBounds();
    return bounds.width;
  }
}
