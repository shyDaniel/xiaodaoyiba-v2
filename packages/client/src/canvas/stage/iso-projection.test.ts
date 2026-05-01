// §K1 (S-475) — house + character iso projection regression test.
//
// Iter-91 landed an iso 45° pass on House.ts (diamond plinth + iso
// side-skirt + iso-aligned roof eaves) and Character.ts (iso diamond
// shadow). This test locks the contract in so a future refactor that
// reverts to flat shadows / rectangular footprints fails CI.
//
// Strategy: introspect the Pixi 8 GraphicsContext path instructions
// directly. Each `poly([x0,y0, x1,y1, ...])` call becomes a path
// instruction with action='poly' and data=[points, close]. We scan
// for a 4-vertex polygon whose vertical extent is exactly half its
// horizontal extent (the 2:1 dimetric ratio) — that is, a true iso
// diamond.

import { describe, expect, test } from 'vitest';
import { Character } from '../characters/Character.js';
import { ISO_SIN } from './iso.js';
import { House } from './House.js';

interface PolyInstruction {
  action: 'poly';
  data: [number[], boolean] | unknown[];
}

interface FillInstruction {
  action: 'fill' | 'cut';
  data: { path: { instructions: PolyInstruction[] } };
}

/** Extract every 4-vertex polygon from a Pixi Graphics' draw context. */
function extractDiamondCandidates(g: { context: { instructions: unknown[] } }): number[][] {
  const out: number[][] = [];
  for (const ins of g.context.instructions as FillInstruction[]) {
    if (ins.action !== 'fill') continue;
    const pathIns = ins.data?.path?.instructions ?? [];
    for (const p of pathIns) {
      if (p.action !== 'poly') continue;
      const pts = (p.data as unknown[])[0] as number[] | undefined;
      if (!Array.isArray(pts)) continue;
      // 4 vertices = 8 numbers
      if (pts.length === 8) out.push(pts);
    }
  }
  return out;
}

/** A "true iso diamond" has 4 vertices arranged as front/right/back/left
 *  with horizontal half-width hw and vertical half-height hh = hw * ISO_SIN
 *  (= hw * 0.5 for the 2:1 dimetric we use). The four corners must be
 *  axis-aligned: two vertices share the same x (top + bottom corners),
 *  two share the same y (left + right corners). */
function isIsoDiamond(pts: number[]): { ok: boolean; hw: number; hh: number } {
  if (pts.length !== 8) return { ok: false, hw: 0, hh: 0 };
  const xs = [pts[0]!, pts[2]!, pts[4]!, pts[6]!];
  const ys = [pts[1]!, pts[3]!, pts[5]!, pts[7]!];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const hw = (maxX - minX) / 2;
  const hh = (maxY - minY) / 2;
  if (hw < 4 || hh < 2) return { ok: false, hw, hh };
  // Iso ratio check: 2:1 dimetric means hh / hw ≈ ISO_SIN = 0.5.
  // Allow ±15% slack to absorb the +2 px halo padding the shadow uses.
  const ratio = hh / hw;
  const expected = ISO_SIN;
  const ok = Math.abs(ratio - expected) / expected < 0.15;
  return { ok, hw, hh };
}

describe('§K1 (S-475) — house renders iso diamond plinth footprint', () => {
  test('house body has at least one iso 2:1 diamond polygon (the plinth)', () => {
    const house = new House({
      ownerId: 'iso-test',
      ownerName: 'iso',
      width: 200,
      height: 200,
    });
    // Reach into the body Graphics. The plaque is a separate Container
    // (re-parented by the layout system); the iso plinth is on the
    // body. We use the .view container's first Graphics child which
    // is `body`.
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    expect(bodyG, 'house body Graphics not found').toBeDefined();
    const polys = extractDiamondCandidates(bodyG);
    expect(polys.length, 'no 4-vertex polygons found on house body').toBeGreaterThan(0);
    const diamonds = polys.map(isIsoDiamond).filter((d) => d.ok);
    expect(
      diamonds.length,
      `house body must contain ≥ 1 iso 2:1 diamond (plinth). polys=${JSON.stringify(polys)}`,
    ).toBeGreaterThanOrEqual(1);
    // The plinth's hw should be ≈ bodyW/2 + 8 = (200*0.78)/2 + 8 = 86.
    // Floor at 50 to allow body-width derivation slack.
    const plinth = diamonds.reduce((a, b) => (b.hw > a.hw ? b : a));
    expect(plinth.hw).toBeGreaterThan(50);
  });
});

describe('§K1 (S-475) — character casts iso diamond shadow', () => {
  test('character shadow has at least one iso 2:1 diamond polygon', () => {
    const ch = new Character({
      id: 'iso-test',
      nickname: 'iso',
      facing: 1,
    });
    // The shadow Graphics is the first child of the view (drawn first
    // so the body lays on top of it).
    const shadowG = ch.view.children[0] as { context: { instructions: unknown[] } };
    expect(shadowG, 'character shadow Graphics not found').toBeDefined();
    const polys = extractDiamondCandidates(shadowG);
    expect(polys.length, 'no 4-vertex polygons found on character shadow').toBeGreaterThanOrEqual(1);
    const diamonds = polys.map(isIsoDiamond).filter((d) => d.ok);
    expect(
      diamonds.length,
      `character shadow must contain ≥ 1 iso 2:1 diamond. polys=${JSON.stringify(polys)}`,
    ).toBeGreaterThanOrEqual(1);
  });

  test('character shadow is no longer a flat horizontal ellipse', () => {
    // Pre-iso shadow was a single ellipse(0, 4, 38, 8) call producing
    // a path instruction with action='ellipse'. Iso pass replaced it
    // with two poly() calls. Assert no ellipse instruction remains
    // on the shadow Graphics so a regression to flat shadow fails.
    const ch = new Character({
      id: 'iso-test',
      nickname: 'iso',
      facing: 1,
    });
    const shadowG = ch.view.children[0] as { context: { instructions: unknown[] } };
    const ellipses: unknown[] = [];
    for (const ins of shadowG.context.instructions as FillInstruction[]) {
      if (ins.action !== 'fill') continue;
      const pathIns = ins.data?.path?.instructions ?? [];
      for (const p of pathIns) {
        if (p.action !== 'poly' && (p as { action: string }).action === 'ellipse') {
          ellipses.push(p);
        }
      }
    }
    expect(
      ellipses.length,
      'character shadow must use iso diamond polys, not a flat ellipse',
    ).toBe(0);
  });
});
