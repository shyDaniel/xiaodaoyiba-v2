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

/** Greedy character-break wrap matching Pixi's `breakWords: true`
 *  behaviour. Returns the list of lines the text will rasterize as,
 *  given a measured-width function (so jsdom + browser take the same
 *  code path). §H1 (S-438). */
function wrapTextToWidth(
  text: string,
  wrapW: number,
  fontSize: number,
  measureW: (s: string, fs: number) => number,
): string[] {
  if (text.length === 0) return [''];
  // Honour explicit newlines first, then greedy-wrap each segment.
  const segments = text.split('\n');
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.length === 0) {
      out.push('');
      continue;
    }
    let cur = '';
    for (const ch of seg) {
      const next = cur + ch;
      if (cur.length > 0 && measureW(next, fontSize) > wrapW) {
        out.push(cur);
        cur = ch;
      } else {
        cur = next;
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
    const plaqueY = roofTop - 32;
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
    const widestCharW = (str: string, fs: number): number => {
      let max = 0;
      for (const ch of str) {
        const wch = measurePixiTextW(ch, fs);
        if (wch > max) max = wch;
      }
      return max;
    };
    let fontSize = 16;
    // The wrap area available to the rasterized text after subtracting
    // the ribbon's inner inset (12 px total — 6 px each side from the
    // innerInset constant below) and TextStyle padding margins.
    const wrapBudget = (): number => {
      // The constraint must match the wrapW computed below. Use the
      // canvas-space cap (which was already reconciled with stationW)
      // minus the same insets.
      return Math.max(20, cap - 24 - 16);
    };
    while (
      Math.ceil(widestCharW(namePool, fontSize)) > wrapBudget() &&
      fontSize > 9
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

    // wordWrapWidth: the Pixi.Text inner content area, leaving 6 px
    // of horizontal inset between glyphs and ribbon edge. We measure
    // the wrapped text's actual rendered width via CanvasTextMetrics
    // and let the ribbon height stretch to fit the line count.
    const innerInset = 6;
    const wrapW = Math.max(20, plaqueW - 2 * innerInset);

    // Compute how many lines the wrap will produce by greedy
    // character-break simulation matching Pixi's breakWords behaviour.
    // We can't query Pixi.Text.height in jsdom (no canvas backend),
    // so the height calc happens in pure TS using measurePixiTextW.
    const wrappedLines = wrapTextToWidth(namePool, wrapW, fontSize, measurePixiTextW);
    const lineH = Math.ceil(fontSize * 1.15);
    // Ribbon height: enough to host every wrapped line plus 8 px
    // top/bottom inset. Floor of 28 keeps single-line plaques the
    // same height as before so 1..4p layouts visually unchanged.
    const plaqueH = Math.max(28, wrappedLines.length * lineH + 12);
    const text = new Text({
      text: namePool,
      style: buildStyle(fontSize, wrapW),
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
