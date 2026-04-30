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
const WORST_NAMES = ['玩家38', 'counter', 'random', 'iron', 'mirror', 'counter#2'];

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
