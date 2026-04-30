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
