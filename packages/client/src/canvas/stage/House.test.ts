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

  // §H1 (S-438) — live-acceptance regression: every plaque's
  // Pixi.Text.text must strictly equal bot.displayName (no '...' /
  // '…' truncation), AND plaque canvas bounds must satisfy
  // left ≥ 4 AND right ≤ canvas.width - 4 across all 6 plaques.
  test('S-438 acceptance: 6p × 375 plaques carry full displayName, stay inside canvas±4', () => {
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

      // 1) Pixi.Text.text must strictly === displayName. wordWrap +
      //    breakWords keeps the .text identical to the input; only
      //    the rasterized layout splits across lines.
      const textChild = house.plaque.children.find(
        (c): c is { text: string } & object =>
          typeof (c as { text?: unknown }).text === 'string',
      ) as ({ text: string } & object) | undefined;
      expect(textChild, `slot=${i} no Pixi.Text child`).toBeDefined();
      expect(
        textChild?.text,
        `slot=${i} name=${name} text='${textChild?.text}'`,
      ).toBe(name);
      // No ellipsis chars must be present.
      expect(textChild?.text).not.toContain('…');
      expect(textChild?.text).not.toContain('...');

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
        // Pixi.Text.text must strictly === displayName (no truncation).
        const textChild = house.plaque.children.find(
          (c): c is { text: string } & object =>
            typeof (c as { text?: unknown }).text === 'string',
        ) as ({ text: string } & object) | undefined;
        expect(textChild?.text, `${vp.tag} slot=${i} name=${name}`).toBe(name);
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
        // Pixi.Text.text strict equality with the displayName.
        const textChild = house.plaque.children.find(
          (c): c is { text: string } & object =>
            typeof (c as { text?: unknown }).text === 'string',
        ) as ({ text: string } & object) | undefined;
        expect(textChild?.text, `${vp.tag} slot=${i} name=${name}`).toBe(name);
        expect(textChild?.text).not.toContain('…');
        expect(textChild?.text).not.toContain('...');
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
  test('S-442: 6p × mobile-375 worst-case names render at fontSize ≥ 9 with full displayName', () => {
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

      // (1) Pixi.Text.text === displayName (no truncation, no ellipsis).
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
        textChild?.text,
        `slot=${i} name='${name}' text='${textChild?.text}'`,
      ).toBe(name);
      expect(textChild?.text).not.toContain('…');
      expect(textChild?.text).not.toContain('...');

      // (2) Plaque canvas bounds preserved from S-439.
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

      // (3) The new S-442 acceptance: fontSize ≥ 9 (humanly legible).
      const fs = textChild!.style.fontSize;
      expect(
        fs,
        `slot=${i} name=${name} fontSize=${fs} (must ≥ 9 — S-442 legibility floor)`,
      ).toBeGreaterThanOrEqual(9);
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
      expect(textChild?.text).toBe(name);
      expect(textChild!.style.fontSize).toBeGreaterThanOrEqual(9);
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
