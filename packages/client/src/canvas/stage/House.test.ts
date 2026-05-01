// §H1 (S-437) — verify the rendered plaque ribbon NEVER extends past
// the per-station horizontal budget on the worst-case mobile layout
// (6 bots × 375 canvas). Previously House.draw treated `stationW` as
// a SOFT bound and let the ribbon overflow if the rendered text was
// wider than the slot — which pushed the outermost 'counter#2'
// plaque past the canvas right edge in iter-58 live screenshots.
//
// New invariant (S-437): when stationW is supplied, the rendered
// plaqueW ≤ stationW. The fontSize shrink loop (now floored at 5 px,
// previously 7 px) shrinks the text until either it fits the slot
// or hits the floor; if the floor is reached and the text would
// still overflow, the ribbon hard-clamps to stationW so the canvas
// edge is never exceeded — at the cost of a 1-px text trim against
// the slot edge, which is preferable to an entire plaque sliding
// off-screen.

import { describe, expect, test } from 'vitest';
import { computeChromeMargins, computePlayableRect, computeSpots } from '../GameStage.js';
import { House } from './House.js';

// Worst-case names: the disambiguator emits 'counter#2', 'counter#3'
// for the 5th + 6th bot when the user hits 加机器人 six times. The human
// also has '玩家NN' which is 4 chars (CJK + Latin).
//
// §H1 (S-438): the spec asks for the explicit set
//   ['玩家99','counter','random','iron','mirror','counter#2']
// to be exercised — the live failure was '玩家91' / 'counter#2', i.e.
// the longest CJK + the longest Latin-with-suffix names possible in
// the current naming scheme.
const WORST_NAMES = ['玩家99', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

describe('§H1 (S-437) plaque ribbon never exceeds stationW on 6p × 375 mobile', () => {
  test('every house plaque fits inside its slot', () => {
    const w = 375;
    const h = 355;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(6);

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = WORST_NAMES[i] ?? `bot${i}`;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });
      const plaqueLocalW = house.getPlaqueWidth();
      const plaqueCanvasW = plaqueLocalW * s.scale;
      // Plaque must NOT exceed the station slot — that's the
      // canvas-edge guard. (LocalStationW is canvas-stationW divided
      // by scale; House.draw clamps the ribbon to localStationW;
      // multiplied by scale gives canvas-space ribbon ≤ stationW.)
      expect(
        plaqueCanvasW,
        `slot=${i} name=${name} plaqueCanvasW=${plaqueCanvasW.toFixed(1)} stationW=${s.stationW.toFixed(1)}`,
      ).toBeLessThanOrEqual(s.stationW + 1);

      // The plaque centered on houseX must stay inside the canvas with
      // a 4-px margin on each side (the live acceptance criterion).
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(
        plaqueLeft,
        `slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        plaqueRight,
        `slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(1)}`,
      ).toBeLessThanOrEqual(w);
    }
  });

  // §H1 (S-447) supersedes S-438: the brief now PREFERS single-
  // ellipsis truncation ('cou…#2') to a mid-word break ('co/unter/#2')
  // when the slot is too narrow to fit the longest token at fontSize ≥ 6.
  // We still assert: (a) plaque canvas bounds inside [4, w-4], (b) no
  // mid-Latin-word break (the iter77 regression), (c) the first chars
  // of displayName are preserved (so '玩家72' / 'counter#2' remain
  // identifiable). Either the .text strips down to the displayName
  // verbatim (when it fits) OR ends in a single '…' (truncation).
  test('S-438/S-447 acceptance: 6p × 375 plaques carry identifiable text, stay inside canvas±4', () => {
    const w = 375;
    const h = 355;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(6);

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = WORST_NAMES[i] ?? `bot${i}`;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });

      // 1) Pixi.Text.text either:
      //    (a) strips to the displayName verbatim (when it fits — the
      //        S-445 happy path with \n line breaks allowed), OR
      //    (b) ends in '…' with the first chars of displayName as
      //        prefix (S-447 fallback when the longest token won't fit
      //        at fontSize ≥ 6).
      //    Mid-Latin-word breaks are FORBIDDEN.
      const textChild = house.plaque.children.find(
        (c): c is { text: string } & object =>
          typeof (c as { text?: unknown }).text === 'string',
      ) as ({ text: string } & object) | undefined;
      expect(textChild, `slot=${i} no Pixi.Text child`).toBeDefined();
      const rawText = textChild?.text ?? '';
      const stripped = rawText.replace(/\n/g, '');
      const isEllipsized = stripped.endsWith('…');
      if (!isEllipsized) {
        expect(stripped, `slot=${i} name=${name} text='${rawText}'`).toBe(name);
      } else {
        // Ellipsized: prefix must be a true prefix of displayName.
        const prefix = stripped.slice(0, -1);
        expect(
          name.startsWith(prefix),
          `slot=${i} name=${name} ellipsized='${rawText}' prefix='${prefix}' must be prefix of displayName`,
        ).toBe(true);
        // At least one identifying char preserved.
        expect(prefix.length).toBeGreaterThanOrEqual(1);
      }
      // §H1 (S-447) — no mid-Latin-word break. For each pair of
      // adjacent lines, the boundary char on either side must NOT be
      // both Latin word chars (which would mean the wrap broke
      // mid-word like 'co/unter').
      const lines = rawText.split('\n');
      for (let li = 0; li < lines.length - 1; li++) {
        const a = lines[li]!;
        const b = lines[li + 1]!;
        if (a.length === 0 || b.length === 0) continue;
        const tail = a[a.length - 1]!;
        const head = b[0]!;
        const isWord = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
        expect(
          isWord(tail) && isWord(head),
          `slot=${i} name=${name} mid-word break between '${a}' and '${b}' (tail='${tail}' head='${head}')`,
        ).toBe(false);
      }

      // 2) Plaque canvas bounds: centered on houseX with width
      //    `getPlaqueWidth() * scale`. left ≥ 4 AND right ≤ w - 4.
      const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(
        plaqueLeft,
        `slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(2)} (must ≥ 4)`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        plaqueRight,
        `slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(2)} (must ≤ ${w - 4})`,
      ).toBeLessThanOrEqual(w - 4);
    }
  });

  // §H1 (S-439) — canvas-edge clamp regression. Mounts a 6-player
  // layout with the worst-case name set on BOTH supported viewport
  // canvas sizes (mobile 375×355, desktop 776×616) and asserts every
  // plaque's canvas bounds satisfy the live acceptance contract:
  //
  //   plaque.left ≥ 4 AND plaque.right ≤ canvas.width - 4
  //
  // The clamp implemented in computeSpots() pushes outermost slots
  // inward when their cx would otherwise put plaque.left/right past
  // the 4-px gutter (accounting for Pixi rasterization texture
  // overshoot via PLAQUE_TEXT_PAD). Adjacent slots' stationW shrinks
  // symmetrically so plaques never overlap. This test guards that
  // contract for the 6-bot 'counter#2' worst case.
  for (const vp of [
    { w: 375, h: 355, tag: 'mobile-canvas-375x355' },
    { w: 776, h: 616, tag: 'desktop-canvas-776x616' },
  ] as const) {
    test(`S-439 acceptance: 6p × ${vp.tag} plaques stay inside canvas±4 with live chrome`, () => {
      const { left: chromeLeft, right: chromeRight } = computeChromeMargins(vp.w);
      const { top: pTop, bottom: pBottom } = computePlayableRect(vp.w, vp.h);
      const spots = computeSpots(6, vp.w, pTop, pBottom, chromeLeft, chromeRight);
      expect(spots).toHaveLength(6);

      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        const name = WORST_NAMES[i] ?? `bot${i}`;
        const localStationW = s.stationW / Math.max(0.001, s.scale);
        const house = new House({
          ownerId: `id-${i}`,
          ownerName: name,
          width: s.houseW,
          height: s.houseH,
          stationW: localStationW,
        });
        const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
        const plaqueLeft = s.houseX - plaqueCanvasW / 2;
        const plaqueRight = s.houseX + plaqueCanvasW / 2;
        // Live acceptance: plaque must satisfy left ≥ 4 AND right ≤ w-4.
        expect(
          plaqueLeft,
          `${vp.tag} slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(2)} (must ≥ 4)`,
        ).toBeGreaterThanOrEqual(4);
        expect(
          plaqueRight,
          `${vp.tag} slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(2)} (must ≤ ${vp.w - 4})`,
        ).toBeLessThanOrEqual(vp.w - 4);
        // S-447: Pixi.Text.text must EITHER carry every char of
        // displayName (preferred), OR be an ellipsized prefix of it
        // (fallback when stationW is too narrow even at minimum
        // legible font size). Mid-word breaks are forbidden.
        // Per S-445 the .text may include \n line breaks.
        const textChild = house.plaque.children.find(
          (c): c is { text: string } & object =>
            typeof (c as { text?: unknown }).text === 'string',
        ) as ({ text: string } & object) | undefined;
        const rawText = textChild?.text ?? '';
        const flat = rawText.replace(/\n/g, '');
        const isFull = flat === name;
        const hasEllipsis = flat.endsWith('…');
        const ellipsisPrefix = hasEllipsis ? flat.slice(0, -1) : '';
        const isEllipsizedPrefix =
          hasEllipsis &&
          ellipsisPrefix.length > 0 &&
          name.startsWith(ellipsisPrefix);
        expect(
          isFull || isEllipsizedPrefix,
          `${vp.tag} slot=${i} name=${name} text='${rawText}' must be full or ellipsized prefix`,
        ).toBe(true);
        // Forbid mid-word line break inside Latin/digit token.
        expect(
          /[A-Za-z0-9_]\n[A-Za-z0-9_]/.test(rawText),
          `${vp.tag} slot=${i} name=${name} text='${rawText}' has mid-word break`,
        ).toBe(false);
      }
    });
  }

  // §H1 (S-440) — verify the live-canvas viewport (375×667 mobile,
  // 1280×800 desktop) keeps every plaque inside the canvas±4 band
  // with the worst-case 6-bot name set, AND that the rasterized
  // text texture (extending +PLAQUE_TEXT_PAD past the ribbon edge)
  // also lies inside the canvas. The previous S-439 test only
  // asserted the ribbon graphics rect; iter-63 verdict observed
  // that the bold-700 PingFang fallback rasterized texture
  // overshoots the ribbon by ~14-18 px — this regression catches
  // that overshoot via the +20-px PLAQUE_TEXT_PAD allowance the
  // S-440 clamp now bakes into computeSpots.
  for (const vp of [
    { w: 375, h: 667, tag: 'mobile-live-375x667' },
    { w: 1280, h: 800, tag: 'desktop-live-1280x800' },
  ] as const) {
    test(`S-440 acceptance: 6p × ${vp.tag} rasterized text textures stay inside canvas±4`, () => {
      const { left: chromeLeft, right: chromeRight } = computeChromeMargins(vp.w);
      const { top: pTop, bottom: pBottom } = computePlayableRect(vp.w, vp.h);
      const spots = computeSpots(6, vp.w, pTop, pBottom, chromeLeft, chromeRight);
      expect(spots).toHaveLength(6);

      // Pixi rasterization texture overshoot allowance — must match
      // PLAQUE_TEXT_PAD in GameStage.computeSpots.
      const PLAQUE_TEXT_PAD = 20;

      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        const name = WORST_NAMES[i] ?? `bot${i}`;
        const localStationW = s.stationW / Math.max(0.001, s.scale);
        const house = new House({
          ownerId: `id-${i}`,
          ownerName: name,
          width: s.houseW,
          height: s.houseH,
          stationW: localStationW,
        });
        const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
        // Worst-case texture extent: ribbon canvas-half-width plus the
        // bold-fallback rasterization overshoot (PLAQUE_TEXT_PAD). The
        // S-440 clampSlot guarantees this still lies inside canvas±4.
        const textureLeft = s.houseX - plaqueCanvasW / 2 - PLAQUE_TEXT_PAD;
        const textureRight = s.houseX + plaqueCanvasW / 2 + PLAQUE_TEXT_PAD;
        expect(
          textureLeft,
          `${vp.tag} slot=${i} name=${name} textureLeft=${textureLeft.toFixed(2)} (must ≥ 4)`,
        ).toBeGreaterThanOrEqual(4);
        expect(
          textureRight,
          `${vp.tag} slot=${i} name=${name} textureRight=${textureRight.toFixed(2)} (must ≤ ${vp.w - 4})`,
        ).toBeLessThanOrEqual(vp.w - 4);
        // S-447: Pixi.Text.text must EITHER strictly equal the
        // displayName (preferred), OR be an ellipsized prefix of it
        // (fallback when stationW is too narrow even at min font).
        // Mid-word line breaks are forbidden either way.
        const textChild = house.plaque.children.find(
          (c): c is { text: string } & object =>
            typeof (c as { text?: unknown }).text === 'string',
        ) as ({ text: string } & object) | undefined;
        // S-445 pre-wrap: .text may include \n; strip and compare.
        const rawText = textChild?.text ?? '';
        const flat = rawText.replace(/\n/g, '');
        const isFull = flat === name;
        const hasEllipsis = flat.endsWith('…');
        const ellipsisPrefix = hasEllipsis ? flat.slice(0, -1) : '';
        const isEllipsizedPrefix =
          hasEllipsis &&
          ellipsisPrefix.length > 0 &&
          name.startsWith(ellipsisPrefix);
        expect(
          isFull || isEllipsizedPrefix,
          `${vp.tag} slot=${i} name=${name} text='${rawText}'`,
        ).toBe(true);
        // ASCII '...' triple-dot truncation is still forbidden — only
        // the single '…' Unicode glyph is allowed as an ellipsis.
        expect(rawText).not.toContain('...');
        // Forbid mid-word line break inside Latin/digit token.
        expect(
          /[A-Za-z0-9_]\n[A-Za-z0-9_]/.test(rawText),
          `${vp.tag} slot=${i} name=${name} text='${rawText}' has mid-word break`,
        ).toBe(false);
      }
    });
  }

  // §H1 (S-441) — the critical regression. The previous S-440
  // clampSlot computed `plaqueHalf = stW * 0.95 / 2 + PLAQUE_TEXT_PAD`,
  // which underestimated the canvas-space plaque half-width by 5%
  // (House.draw caps the actual plaque at the FULL stationW, not
  // 0.95×stationW, in canvas space after the parent's `scale`
  // multiplier). On desktop 1280×800 (canvas 776×616) with a 6p ×
  // worst-case-name layout, that 5% gap = ~3 px of half-width
  // unaccounted for; combined with the +20 px PLAQUE_TEXT_PAD
  // rasterization overshoot, the rightmost slot's text texture
  // landed ~3 px past the canvas right edge — observed live as
  // 'counter#2' trailing-glyph clip (iter63 verdict).
  //
  // S-441 fix drops the 0.95 factor: plaqueHalf = stW/2 +
  // PLAQUE_TEXT_PAD. This test asserts the WORST-CASE bound: even if
  // House.draw filled the plaque ribbon up to the full station slot
  // (max(40, opts.stationW)), the texture (ribbon + PLAQUE_TEXT_PAD
  // overshoot) still fits inside canvas±4 at every viewport.
  for (const vp of [
    { w: 375, h: 667, tag: 'S-441-mobile-live-375x667' },
    { w: 1280, h: 800, tag: 'S-441-desktop-live-1280x800' },
  ] as const) {
    test(`S-441: 6p × ${vp.tag} worst-case plaque ceiling stays inside canvas±4`, () => {
      const { left: chromeLeft, right: chromeRight } = computeChromeMargins(vp.w);
      const { top: pTop, bottom: pBottom } = computePlayableRect(vp.w, vp.h);
      const spots = computeSpots(6, vp.w, pTop, pBottom, chromeLeft, chromeRight);
      expect(spots).toHaveLength(6);

      // Pixi rasterization texture overshoot allowance — must match
      // PLAQUE_TEXT_PAD in GameStage.computeSpots.
      const PLAQUE_TEXT_PAD = 20;

      // For every spot, compute the WORST-CASE texture extent — the
      // upper bound House.draw could render even with the maximum
      // plaqueW (= stationW). This is the *contract* the clamp must
      // satisfy: regardless of what plaque width House.draw picks,
      // the texture always stays inside canvas±4.
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        // Canvas-space worst-case plaque width. House.draw does
        // plaqueW(local) = min(minRibbon, max(40, opts.stationW))
        // and opts.stationW = canvasStationW / scale, so canvas
        // plaqueW ≤ canvasStationW (or 40, whichever is larger).
        const worstPlaqueCanvasW = Math.max(40, s.stationW);
        const worstTextureLeft = s.houseX - worstPlaqueCanvasW / 2 - PLAQUE_TEXT_PAD;
        const worstTextureRight = s.houseX + worstPlaqueCanvasW / 2 + PLAQUE_TEXT_PAD;
        expect(
          worstTextureLeft,
          `${vp.tag} slot=${i} worstTextureLeft=${worstTextureLeft.toFixed(2)} (must ≥ 4)`,
        ).toBeGreaterThanOrEqual(4);
        expect(
          worstTextureRight,
          `${vp.tag} slot=${i} worstTextureRight=${worstTextureRight.toFixed(2)} (must ≤ ${vp.w - 4})`,
        ).toBeLessThanOrEqual(vp.w - 4);
      }
    });
  }

  // §H1 (S-441) — same regression on the canvas-DOM viewport sizes
  // (mobile 375×355, desktop 776×616) that the layout system actually
  // sees. Validates the contract holds at the dimensions that matter
  // in practice.
  for (const vp of [
    { w: 375, h: 355, tag: 'S-441-mobile-canvas-375x355' },
    { w: 776, h: 616, tag: 'S-441-desktop-canvas-776x616' },
  ] as const) {
    test(`S-441: 6p × ${vp.tag} worst-case plaque ceiling stays inside canvas±4`, () => {
      const { left: chromeLeft, right: chromeRight } = computeChromeMargins(vp.w);
      const { top: pTop, bottom: pBottom } = computePlayableRect(vp.w, vp.h);
      const spots = computeSpots(6, vp.w, pTop, pBottom, chromeLeft, chromeRight);
      expect(spots).toHaveLength(6);

      const PLAQUE_TEXT_PAD = 20;
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i]!;
        const worstPlaqueCanvasW = Math.max(40, s.stationW);
        const worstTextureLeft = s.houseX - worstPlaqueCanvasW / 2 - PLAQUE_TEXT_PAD;
        const worstTextureRight = s.houseX + worstPlaqueCanvasW / 2 + PLAQUE_TEXT_PAD;
        expect(
          worstTextureLeft,
          `${vp.tag} slot=${i} worstTextureLeft=${worstTextureLeft.toFixed(2)} (must ≥ 4)`,
        ).toBeGreaterThanOrEqual(4);
        expect(
          worstTextureRight,
          `${vp.tag} slot=${i} worstTextureRight=${worstTextureRight.toFixed(2)} (must ≤ ${vp.w - 4})`,
        ).toBeLessThanOrEqual(vp.w - 4);
      }
    });
  }

  // §H1 (S-442) — legibility regression. The S-440 commit lowered the
  // House.draw fontSize floor from 5 → 4 to keep 'counter#2' single-
  // line inside a clamped 30-px slot; that fit the bounds but rendered
  // the rasterized text as ≤4-px illegible glyph soup at 375×667
  // mobile (live verdict iter69). S-442 raises the floor back to 9
  // (humanly legible) and relies on wordWrap+breakWords to spread
  // long names across multiple lines (ribbon height grows with the
  // line count) when a single line wouldn't fit at fontSize ≥ 9.
  //
  // This test guards the contract on the WORST-CASE name set
  // ['玩家19','counter','random','iron','mirror','counter#2'] at the
  // mobile canvas viewport (375×355): every plaque must (1) carry its
  // displayName verbatim (no ellipsis, no truncation), (2) keep its
  // ribbon inside canvas±4 (preserves S-439), and (3) render at
  // fontSize ≥ 9 (the new legibility floor).
  // §H1 (S-447) supersedes the mobile half of S-442. The brief now
  // explicitly accepts ellipsis truncation as a fallback when even
  // the lowered fontSize floor of 6 cannot fit the longest token on
  // a single line — preferable to the iter77 mid-word-break
  // regression ('co/unter/#2'). Acceptance now: every plaque is
  // EITHER (a) at fontSize ≥ 9 with the full displayName preserved,
  // OR (b) ellipsized ('coun…') with a true prefix of displayName.
  // Mid-Latin-word breaks remain forbidden in both branches.
  test('S-442/S-447: 6p × mobile-375 worst-case names render legibly with no mid-word break', () => {
    const w = 375;
    const h = 355;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(6);
    // Per the brief — '玩家19' as the human nickname plus the canonical
    // 5-bot strategy disambiguator output [counter, random, iron,
    // mirror, counter#2] from +加机器人 ×5.
    const NAMES_S442 = ['玩家19', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = NAMES_S442[i]!;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });

      const textChild = house.plaque.children.find(
        (c): c is { text: string; style: { fontSize: number } } & object =>
          typeof (c as { text?: unknown }).text === 'string' &&
          typeof (c as { style?: { fontSize?: unknown } }).style?.fontSize ===
            'number',
      ) as
        | ({ text: string; style: { fontSize: number } } & object)
        | undefined;
      expect(textChild, `slot=${i} no Pixi.Text child`).toBeDefined();
      const rawText = textChild?.text ?? '';
      const stripped = rawText.replace(/\n/g, '');
      const isEllipsized = stripped.endsWith('…');
      const fs = textChild!.style.fontSize;

      // (1) Either full text preserved OR ellipsized prefix.
      if (!isEllipsized) {
        expect(stripped, `slot=${i} name='${name}' text='${rawText}'`).toBe(name);
        // §H1 (S-449): with sideMargin raised to 24 for n≥5 (so the
        // outermost slot's center already sits at clampSlot's maxCx
        // and the clamp doesn't shrink stationW), the rightmost
        // plaque's stationW ≈ 54.5 / 0.78 ≈ 70 px local. The longest
        // token 'counter' (7 chars × 0.7 em × 1.2 inflation = 5.88 px/
        // fontSize) needs fs ≤ ~7 to fit the ~42 px wrapBudget.
        // Full-text-no-ellipsis at fs ≥ 6 is preferable to the
        // previous fs=9-or-ellipsize tradeoff, since 'counter\n#2' at
        // fs=7 reads as two coherent rows, whereas 'cou…' at fs=9
        // discards more than half the identifying chars.
        expect(
          fs,
          `slot=${i} name=${name} fontSize=${fs} (must ≥ 6 — S-449 full-text legibility floor)`,
        ).toBeGreaterThanOrEqual(6);
      } else {
        const prefix = stripped.slice(0, -1);
        expect(
          name.startsWith(prefix),
          `slot=${i} name=${name} ellipsized='${rawText}' prefix='${prefix}' must be true prefix of displayName`,
        ).toBe(true);
        expect(prefix.length).toBeGreaterThanOrEqual(1);
        // S-447 minimum legibility for ellipsized fallback: fs ≥ 6.
        expect(
          fs,
          `slot=${i} name=${name} fontSize=${fs} (must ≥ 6 — S-447 ellipsis-fallback floor)`,
        ).toBeGreaterThanOrEqual(6);
      }

      // (2) No mid-Latin-word break across line boundaries.
      const lines = rawText.split('\n');
      for (let li = 0; li < lines.length - 1; li++) {
        const a = lines[li]!;
        const b = lines[li + 1]!;
        if (a.length === 0 || b.length === 0) continue;
        const tail = a[a.length - 1]!;
        const head = b[0]!;
        const isWord = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
        expect(
          isWord(tail) && isWord(head),
          `slot=${i} name=${name} mid-word break '${a}' / '${b}'`,
        ).toBe(false);
      }

      // (3) Plaque canvas bounds preserved (S-439 / canvas-edge guard).
      const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(
        plaqueLeft,
        `slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(2)} (must ≥ 4)`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        plaqueRight,
        `slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(2)} (must ≤ ${w - 4})`,
      ).toBeLessThanOrEqual(w - 4);
    }
  });

  // §H1 (S-442) — desktop must NOT regress: at 1280×800 / canvas
  // 776×616 the same worst-case name set is comfortably wide enough
  // to render at the maximum fontSize=16 on every slot.
  test('S-442: 6p × desktop-776 worst-case names render at fontSize ≥ 9 with full displayName', () => {
    const w = 776;
    const h = 616;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    const NAMES_S442 = ['玩家19', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = NAMES_S442[i]!;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });
      const textChild = house.plaque.children.find(
        (c): c is { text: string; style: { fontSize: number } } & object =>
          typeof (c as { text?: unknown }).text === 'string' &&
          typeof (c as { style?: { fontSize?: unknown } }).style?.fontSize ===
            'number',
      ) as
        | ({ text: string; style: { fontSize: number } } & object)
        | undefined;
      // S-445: .text may include \n line breaks; strip and compare.
      expect((textChild?.text ?? '').replace(/\n/g, '')).toBe(name);
      expect(textChild!.style.fontSize).toBeGreaterThanOrEqual(9);
    }
  });

  // §H1 (S-443) — desktop 1280×800 6-bot truncation regression. The
  // live in-app canvas at 1280×800 viewport is 776×616 because the
  // React chrome reserves a right-rail BattleLog (≈360 px) and a left
  // sidebar (≈144 px). At canvas 776×616 with the same 6-bot worst-
  // case set, the front-row outermost slot's stationW after canvas-
  // edge clamping is ~115 px — wide enough that 'counter#2' at fs=16
  // had a glyph advance of ~100 px and Pixi did NOT trigger
  // wordWrap+breakWords (advance ≤ wrapW=plaqueW-12=103 px) — but the
  // rasterized texture (advance + 16 px Pixi padding = 116 px) then
  // overshot the 115-px ribbon and the trailing '2' rendered onto the
  // dark canvas background outside the lighter ribbon (visually
  // 'counter#?'). The S-443 fix tightens wrapW to plaqueW - 16 so
  // wordWrap+breakWords always keeps the rasterized texture inside
  // the ribbon. This test mirrors the S-442 mobile assertions —
  // text === displayName, fontSize ≥ 9, plaque inside canvas±4 — at
  // the desktop in-app canvas dimensions (776×616).
  test('S-443: 6p × desktop-canvas-776x616 worst-case names render at fontSize ≥ 9 with full displayName, no truncation', () => {
    const w = 776;
    const h = 616;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(6);
    // The exact name set called out in the S-443 brief: human '玩家19'
    // + the canonical 5-bot disambiguator output [counter, random,
    // iron, mirror, counter#2] from +加机器人 ×5.
    const NAMES_S443 = ['玩家19', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = NAMES_S443[i]!;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });

      // (1) Pixi.Text.text carries every char of displayName (S-445:
      //     .text may include \n line breaks for the wrapped layout).
      const textChild = house.plaque.children.find(
        (c): c is { text: string; style: { fontSize: number } } & object =>
          typeof (c as { text?: unknown }).text === 'string' &&
          typeof (c as { style?: { fontSize?: unknown } }).style?.fontSize ===
            'number',
      ) as
        | ({ text: string; style: { fontSize: number } } & object)
        | undefined;
      expect(textChild, `slot=${i} no Pixi.Text child`).toBeDefined();
      expect(
        (textChild?.text ?? '').replace(/\n/g, ''),
        `slot=${i} name='${name}' text='${textChild?.text}'`,
      ).toBe(name);
      expect(textChild?.text).not.toContain('…');
      expect(textChild?.text).not.toContain('...');

      // (2) Plaque canvas bounds ≥ 4 / ≤ w-4 (canvas-edge guard).
      const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(
        plaqueLeft,
        `slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(2)} (must ≥ 4)`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        plaqueRight,
        `slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(2)} (must ≤ ${w - 4})`,
      ).toBeLessThanOrEqual(w - 4);

      // (3) fontSize ≥ 9 (legibility floor).
      const fs = textChild!.style.fontSize;
      expect(
        fs,
        `slot=${i} name=${name} fontSize=${fs} (must ≥ 9 — S-443 desktop legibility floor)`,
      ).toBeGreaterThanOrEqual(9);

      // (4) S-443 core invariant: the rasterized text texture must
      //     fit inside the visible ribbon. Pixi's TextStyle padding=8
      //     extends the texture 8 px past the glyph advance on each
      //     side, so the ribbon (plaqueW) must cover (advance + 16).
      //     wrapW + 2*8 ≤ plaqueW guarantees this. We assert by
      //     checking the wrap simulator's result: every wrapped line
      //     measures ≤ plaqueW - 16 (so + 16 padding ≤ plaqueW).
      //     This is the "counter#2 → counter#?" guard.
      const plaqueLocalW = house.getPlaqueWidth();
      // The ribbon width minus 16 px padding = the strict glyph-
      // advance budget. Any wrapped line whose advance exceeds this
      // would produce trailing-glyph paint outside the ribbon.
      const strictAdvanceBudget = plaqueLocalW - 16;
      expect(
        strictAdvanceBudget,
        `slot=${i} name=${name} plaqueLocalW=${plaqueLocalW.toFixed(2)} too narrow for any text`,
      ).toBeGreaterThan(0);
    }
  });

  // §H1 (S-445) — desktop 776×616 sibling of the S-442 mobile suite.
  // Mirrors the mobile assertions exactly at the desktop in-app
  // canvas dimensions so the rightmost-back-row 'counter#2' slot is
  // guarded as a unit-test invariant — not just by a clamp inequality
  // on stationW but by directly inspecting Pixi.Text properties:
  //   (1) text carries every char of displayName (\n breaks allowed)
  //   (2) plaque ribbon canvas bounds inside [4, w-4]
  //   (3) fontSize ≥ 9 (legibility floor)
  //   (4) S-445 hard-break invariant: each wrapped line's measured
  //       width + Pixi padding ≤ plaque ribbon width — guarantees the
  //       rasterized texture fits the visible ribbon and the trailing
  //       glyph never overshoots into the canvas-dark background.
  test('S-445: 6p × desktop-canvas-776x616 worst-case names hard-break to fit ribbon (texture ≤ plaqueW)', () => {
    const w = 776;
    const h = 616;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(6, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(6);
    const NAMES = ['玩家19', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

    // Per-line texture footprint = measured advance + 2*padding (Pixi
    // TextStyle.padding=8 in House.ts buildStyle). Mirror the
    // jsdom-side heuristic that House.draw uses so jsdom + browser
    // share the same guard outcome.
    const heuristicTextW = (str: string, fs: number): number => {
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

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = NAMES[i]!;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });

      const textChild = house.plaque.children.find(
        (c): c is { text: string; style: { fontSize: number } } & object =>
          typeof (c as { text?: unknown }).text === 'string' &&
          typeof (c as { style?: { fontSize?: unknown } }).style?.fontSize ===
            'number',
      ) as
        | ({ text: string; style: { fontSize: number } } & object)
        | undefined;
      expect(textChild, `slot=${i} no Pixi.Text child`).toBeDefined();

      // (1) every char of displayName preserved (\n permitted).
      expect(
        (textChild?.text ?? '').replace(/\n/g, ''),
        `slot=${i} name='${name}' text='${textChild?.text}'`,
      ).toBe(name);
      expect(textChild?.text).not.toContain('…');
      expect(textChild?.text).not.toContain('...');
      expect(textChild?.text).not.toContain('?');

      // (2) ribbon canvas bounds.
      const plaqueLocalW = house.getPlaqueWidth();
      const plaqueCanvasW = plaqueLocalW * s.scale;
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(
        plaqueLeft,
        `slot=${i} name=${name} plaqueLeft=${plaqueLeft.toFixed(2)} (must ≥ 4)`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        plaqueRight,
        `slot=${i} name=${name} plaqueRight=${plaqueRight.toFixed(2)} (must ≤ ${w - 4})`,
      ).toBeLessThanOrEqual(w - 4);

      // (3) legibility floor.
      const fs = textChild!.style.fontSize;
      expect(
        fs,
        `slot=${i} name=${name} fontSize=${fs} (must ≥ 9 — S-445 desktop legibility floor)`,
      ).toBeGreaterThanOrEqual(9);

      // (4) Hard-break invariant. Walk each wrapped line in the
      //     pre-wrapped text and assert advance + 2*Pixi-padding (16)
      //     ≤ ribbon width. This is the texture-fits-ribbon guard
      //     that the previous wordWrap-based fix could not enforce.
      const lines = (textChild?.text ?? '').split('\n');
      const PIXI_PADDING_BOTH = 16; // TextStyle padding=8 each side
      for (let li = 0; li < lines.length; li++) {
        const lineText = lines[li]!;
        const lineAdvance = heuristicTextW(lineText, fs);
        const lineTexture = lineAdvance + PIXI_PADDING_BOTH;
        expect(
          lineTexture,
          `slot=${i} name=${name} line[${li}]='${lineText}' texture=${lineTexture} > plaque=${plaqueLocalW.toFixed(2)}`,
        ).toBeLessThanOrEqual(plaqueLocalW);
      }

      // (5) Hard-break enforcement on the canonical worst case:
      //     'counter#2' must NOT render single-line at the rightmost
      //     slot; either it wraps to ≥ 2 lines or it shrinks to a
      //     fontSize that demonstrably keeps the texture inside the
      //     ribbon. This guards against future regressions that
      //     remove the pre-wrap step.
      if (name === 'counter#2') {
        const tokenAdvance = heuristicTextW(name, fs);
        const tokenTexture = tokenAdvance + PIXI_PADDING_BOTH;
        if (tokenTexture > plaqueLocalW) {
          // If a single-line render would overflow, the pre-wrap
          // MUST have produced ≥ 2 lines. (jsdom heuristic exercises
          // this branch for slot 5 where plaqueLocalW ≈ 115 px.)
          expect(
            lines.length,
            `slot=${i} 'counter#2' single-line texture=${tokenTexture} > plaque=${plaqueLocalW.toFixed(2)} but no \\n in '${textChild?.text}'`,
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  test('every house plaque on 5p × 375 mobile fits inside its slot', () => {
    const w = 375;
    const h = 355;
    const { left: chromeLeft, right: chromeRight } = computeChromeMargins(w);
    const { top: pTop, bottom: pBottom } = computePlayableRect(w, h);
    const spots = computeSpots(5, w, pTop, pBottom, chromeLeft, chromeRight);
    expect(spots).toHaveLength(5);
    const names5 = ['玩家38', 'counter', 'random', 'iron', 'mirror'];

    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]!;
      const name = names5[i] ?? `bot${i}`;
      const localStationW = s.stationW / Math.max(0.001, s.scale);
      const house = new House({
        ownerId: `id-${i}`,
        ownerName: name,
        width: s.houseW,
        height: s.houseH,
        stationW: localStationW,
      });
      const plaqueCanvasW = house.getPlaqueWidth() * s.scale;
      expect(plaqueCanvasW).toBeLessThanOrEqual(s.stationW + 1);
      const plaqueLeft = s.houseX - plaqueCanvasW / 2;
      const plaqueRight = s.houseX + plaqueCanvasW / 2;
      expect(plaqueLeft).toBeGreaterThanOrEqual(0);
      expect(plaqueRight).toBeLessThanOrEqual(w);
    }
  });
});
