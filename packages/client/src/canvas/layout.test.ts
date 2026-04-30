// §H1 layout regression tests — verify computeSpots() never produces a
// station whose visual bounding box clips below the playable bottom or
// above the playable top, across every (player_count ∈ {2..6}) ×
// (viewport ∈ {1280×800, 375×667}) combination.
//
// House visual extent (post-draw): bottom anchor = (houseX, houseY);
// the body covers y ∈ [houseY - bodyH, houseY], the roof peaks at
// y ≈ houseY - bodyH - opts.height*0.4, the plaque ribbon adds another
// ~32 px above the roof. With bodyH = 0.55*opts.height, total visual
// extent above the anchor ≈ 0.55*opts.height + 0.4*opts.height + 32 ≈
// 0.95*opts.height + 32 (per-spot sprite-local) — but the spot also has
// scale, so the canvas-space extent is `(0.95*houseH + 32) * scale`.
//
// Character visual extent (post-draw): feet anchor at (charX, charY);
// the head top sits at y = charY - 128 * (1.05 * scale). The character
// has no nameplate (the nameplate is on the house plaque).

import { describe, expect, test } from 'vitest';
import { computePlayableRect, computeSpots } from './GameStage.js';

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function houseBox(spot: ReturnType<typeof computeSpots>[number]): Box {
  // Visual extent above the bottom-anchor (houseX, houseY):
  //   body height = houseH * 0.55
  //   roof peaks  = body + houseH * 0.4
  //   plaque adds ~32 above roof, plus the 4-px text margin
  const aboveAnchor = (spot.houseH * 0.55 + spot.houseH * 0.4 + 36) * spot.scale;
  const halfW = (spot.houseW * 0.78 / 2 + 16) * spot.scale; // bodyW + roof eave
  return {
    top: spot.houseY - aboveAnchor,
    bottom: spot.houseY,
    left: spot.houseX - halfW,
    right: spot.houseX + halfW,
  };
}

function charBox(spot: ReturnType<typeof computeSpots>[number]): Box {
  // Character vertical extent: feet at (charX, charY); head top at
  // charY - 128 * baseScale; the briefs/feet sit slightly below the
  // anchor (feet shadow = 4px). baseScale = 1.05 * spot.scale.
  const baseScale = 1.05 * spot.scale;
  return {
    top: spot.charY - 128 * baseScale,
    bottom: spot.charY + 4 * baseScale,
    left: spot.charX - 28 * baseScale,
    right: spot.charX + 28 * baseScale,
  };
}

const VIEWPORTS: Array<{ w: number; h: number; tag: string }> = [
  { w: 1280, h: 800, tag: 'desktop-1280x800' },
  { w: 375, h: 667, tag: 'mobile-375x667' },
];
const PLAYER_COUNTS = [2, 3, 4, 5, 6];

describe('§H1 mobile + desktop layout: no clipping for 2..6 players × {1280×800, 375×667}', () => {
  for (const vp of VIEWPORTS) {
    const { top: pTop, bottom: pBottom } = computePlayableRect(vp.w, vp.h);

    test(`${vp.tag} playable rect non-empty`, () => {
      expect(pBottom - pTop).toBeGreaterThan(150);
      expect(pBottom).toBeLessThanOrEqual(vp.h);
      expect(pTop).toBeGreaterThanOrEqual(0);
    });

    for (const n of PLAYER_COUNTS) {
      test(`${vp.tag} ${n} players: every spot fits inside playable rect`, () => {
        const spots = computeSpots(n, vp.w, pTop, pBottom);
        expect(spots).toHaveLength(n);

        for (let i = 0; i < spots.length; i++) {
          const s = spots[i]!;
          const hb = houseBox(s);
          const cb = charBox(s);

          // Houses must not clip the top (roof + plaque visible) or the
          // bottom (foundation + stoop visible) of the playable rect.
          expect(hb.top, `${vp.tag} n=${n} i=${i} house top`).toBeGreaterThanOrEqual(
            pTop - 1,
          );
          expect(hb.bottom, `${vp.tag} n=${n} i=${i} house bottom`).toBeLessThanOrEqual(
            pBottom + 1,
          );

          // Characters must not clip the top (head visible) or the
          // bottom (feet + briefs visible) of the playable rect.
          expect(cb.top, `${vp.tag} n=${n} i=${i} char top`).toBeGreaterThanOrEqual(
            pTop - 1,
          );
          expect(cb.bottom, `${vp.tag} n=${n} i=${i} char bottom`).toBeLessThanOrEqual(
            pBottom + 1,
          );

          // Stations must not slide off the left/right canvas edges.
          expect(hb.left, `${vp.tag} n=${n} i=${i} house left`).toBeGreaterThanOrEqual(
            -2,
          );
          expect(hb.right, `${vp.tag} n=${n} i=${i} house right`).toBeLessThanOrEqual(
            vp.w + 2,
          );
          expect(cb.left, `${vp.tag} n=${n} i=${i} char left`).toBeGreaterThanOrEqual(
            -2,
          );
          expect(cb.right, `${vp.tag} n=${n} i=${i} char right`).toBeLessThanOrEqual(
            vp.w + 2,
          );
        }
      });

      test(`${vp.tag} ${n} players: stations are non-degenerate`, () => {
        const spots = computeSpots(n, vp.w, pTop, pBottom);
        for (const s of spots) {
          expect(s.scale, `scale for ${vp.tag} n=${n}`).toBeGreaterThan(0.45);
          expect(s.houseW).toBeGreaterThan(80);
          expect(s.houseH).toBeGreaterThan(90);
        }
      });

      // §H1 — same-row stations must NOT overlap horizontally. Stations
      // in different rows (different houseY) may overlap in x because
      // the z-order separation handles them.
      test(`${vp.tag} ${n} players: same-row stations do not overlap in x`, () => {
        const spots = computeSpots(n, vp.w, pTop, pBottom);
        // Group by row (houseY rounded). Stations within ±2 px are
        // considered "same row".
        const rows = new Map<number, typeof spots>();
        for (const s of spots) {
          const key = Math.round(s.houseY / 4) * 4;
          const arr = rows.get(key) ?? [];
          arr.push(s);
          rows.set(key, arr);
        }
        for (const arr of rows.values()) {
          if (arr.length < 2) continue;
          arr.sort((a, b) => a.houseX - b.houseX);
          for (let i = 1; i < arr.length; i++) {
            const a = arr[i - 1]!;
            const b = arr[i]!;
            const aRight = a.houseX + (a.houseW * 0.78 / 2 + 16) * a.scale;
            const bLeft = b.houseX - (b.houseW * 0.78 / 2 + 16) * b.scale;
            expect(
              bLeft,
              `${vp.tag} n=${n} same-row stations ${i - 1}/${i} overlap in x`,
            ).toBeGreaterThanOrEqual(aRight - 1);
          }
        }
      });
    }
  }
});
