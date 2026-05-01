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

describe('§K1 (S-503) — house renders iso parallelogram plinth footprint', () => {
  // S-503 supersedes the S-475 "axis-aligned diamond plinth" test. The
  // S-475 plinth was a corner-facing 4-vertex diamond with two corners
  // sharing y (left+right) and two sharing x (front+back) — bilaterally
  // symmetric and read as a flat front-elevation rectangle in live
  // renders. S-503 replaces it with an ASYMMETRIC parallelogram whose
  // 4 corners are projections of an LX × LZ rectangular footprint
  // (LX > LZ) through worldToScreen. The result is a parallelogram
  // (no two corners share x; no two share y exactly) — the modern
  // Hades / Stardew look.
  test('house body has at least one iso parallelogram polygon (the plinth)', () => {
    const house = new House({
      ownerId: 'iso-test',
      ownerName: 'iso',
      width: 200,
      height: 200,
    });
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    expect(bodyG, 'house body Graphics not found').toBeDefined();
    const polys = extractDiamondCandidates(bodyG);
    expect(polys.length, 'no 4-vertex polygons found on house body').toBeGreaterThan(0);

    // An iso footprint parallelogram has:
    //   • 4 vertices
    //   • opposite edges parallel (parallelogram property)
    //   • non-trivial bbox (w ≥ 100 for bodyW=156 and overhang)
    //   • slope of one edge pair matches +ISO_SIN (going up-and-right
    //     along world +X), the other pair matches -ISO_SIN (going up-
    //     and-left along world +Z). The two slopes have OPPOSITE
    //     signs so the figure tilts in both directions — that's the
    //     iso-footprint signature.
    const isParallelogramFootprint = (pts: number[]): boolean => {
      if (pts.length !== 8) return false;
      const xs = [pts[0]!, pts[2]!, pts[4]!, pts[6]!];
      const ys = [pts[1]!, pts[3]!, pts[5]!, pts[7]!];
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      if (w < 100 || h < 30) return false;
      // Edge slopes (dy/dx).
      const slopes: number[] = [];
      for (let i = 0; i < 4; i++) {
        const x0 = pts[i * 2]!;
        const y0 = pts[i * 2 + 1]!;
        const x1 = pts[((i + 1) % 4) * 2]!;
        const y1 = pts[((i + 1) % 4) * 2 + 1]!;
        const dx = x1 - x0;
        const dy = y1 - y0;
        if (Math.abs(dx) < 0.5) return false; // no vertical edges
        slopes.push(dy / dx);
      }
      // Opposite edges must have ~equal slope (parallelogram).
      const par1 = Math.abs(slopes[0]! - slopes[2]!) < 0.05;
      const par2 = Math.abs(slopes[1]! - slopes[3]!) < 0.05;
      if (!par1 || !par2) return false;
      // The two edge-pair slopes must have OPPOSITE signs (one +ISO_SIN/cos,
      // one -ISO_SIN/cos for the iso basis).
      const sgn0 = Math.sign(slopes[0]!);
      const sgn1 = Math.sign(slopes[1]!);
      return sgn0 !== 0 && sgn1 !== 0 && sgn0 !== sgn1;
    };
    const footprintPolys = polys.filter(isParallelogramFootprint);
    expect(
      footprintPolys.length,
      `expected ≥ 1 iso parallelogram footprint poly (plinth). ISO_SIN=${ISO_SIN}. polys=${JSON.stringify(polys)}`,
    ).toBeGreaterThanOrEqual(1);
    // Pick the largest — that's the plinth.
    const plinth = footprintPolys.reduce((a, b) => {
      const aw = Math.max(a[0]!, a[2]!, a[4]!, a[6]!) - Math.min(a[0]!, a[2]!, a[4]!, a[6]!);
      const bw = Math.max(b[0]!, b[2]!, b[4]!, b[6]!) - Math.min(b[0]!, b[2]!, b[4]!, b[6]!);
      return bw > aw ? b : a;
    });
    const pxs = [plinth[0]!, plinth[2]!, plinth[4]!, plinth[6]!];
    const plinthW = Math.max(...pxs) - Math.min(...pxs);
    expect(plinthW).toBeGreaterThan(100);
  });
});

describe('§K1 (S-503) — house front-LEFT and front-RIGHT wall faces have visibly different widths', () => {
  // The acceptance criterion for S-503: front-wall poly width / height
  // ratio MUST differ from side-wall ratio per the dimetric basis.
  // This locks that the asymmetric footprint (footLX > footLZ) is
  // honored in the wall geometry — without it, S-497's bilaterally
  // symmetric front-left ≡ front-right walls returned, which read
  // as a flat front-elevation rectangle in live renders.
  test('largest two skewed wall polys have visibly different widths (LX != LZ)', () => {
    const house = new House({
      ownerId: 'iso-asym-test',
      ownerName: 'asym',
      width: 200,
      height: 200,
    });
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    const polys = extractDiamondCandidates(bodyG);

    // A wall poly is a 4-vertex iso parallelogram with significant
    // height (the wall rises from base to top) AND bbox.w ≥ 30. We
    // separate "left-leaning" (slope from front-base going up-LEFT,
    // i.e. into the front-LEFT face) from "right-leaning" (slope
    // going up-RIGHT, i.e. into the front-RIGHT face) by inspecting
    // the bottom edge's direction.
    function classifyWall(pts: number[]): {
      kind: 'left' | 'right' | 'none';
      bottomLen: number;
      h: number;
    } {
      if (pts.length !== 8) return { kind: 'none', bottomLen: 0, h: 0 };
      const xs = [pts[0]!, pts[2]!, pts[4]!, pts[6]!];
      const ys = [pts[1]!, pts[3]!, pts[5]!, pts[7]!];
      const h = Math.max(...ys) - Math.min(...ys);
      if (h < 50) return { kind: 'none', bottomLen: 0, h };
      // Skip the PLINTH parallelogram: its corners straddle y=0 (front
      // corner at y > 0 below the base, back corner at y < 0). Walls
      // have all corners at y ≤ 0 (they rise UP from the base).
      const maxY = Math.max(...ys);
      if (maxY > 1) return { kind: 'none', bottomLen: 0, h };
      // Find the two BOTTOM corners (the two vertices with the largest y).
      const sortedIdx = [0, 1, 2, 3].sort((a, b) => ys[b]! - ys[a]!);
      const b0 = sortedIdx[0]!;
      const b1 = sortedIdx[1]!;
      const bx0 = xs[b0]!;
      const by0 = ys[b0]!;
      const bx1 = xs[b1]!;
      const by1 = ys[b1]!;
      const dx = bx1 - bx0;
      const dy = by1 - by0;
      const bottomLen = Math.hypot(dx, dy);
      if (bottomLen < 30) return { kind: 'none', bottomLen, h };
      // Wall faces have a bottom edge that is iso-skewed (not horiz,
      // not vert).  If dx and dy have the same sign (both + or both -)
      // when reading from the right-most-x bottom corner toward the
      // other, the edge slopes UP-LEFT (into the back-left) → that is
      // the front-LEFT wall's bottom edge.  Opposite signs → front-
      // RIGHT.  We canonicalize by always reading from the corner
      // with the LARGER x to the smaller x.
      const fromRight = bx0 > bx1
        ? { dxr: bx1 - bx0, dyr: by1 - by0 }
        : { dxr: bx0 - bx1, dyr: by0 - by1 };
      // dxr is now negative (going LEFT). If dyr is also negative,
      // the edge goes UP and LEFT → front-LEFT wall.  If dyr is
      // positive (going DOWN and LEFT), the edge goes DOWN and LEFT
      // — that's the front-RIGHT wall's bottom edge as read from
      // the front corner.
      const kind: 'left' | 'right' =
        fromRight.dyr < 0 ? 'left' : 'right';
      return { kind, bottomLen, h };
    }

    const walls = polys
      .map((pts) => ({ pts, ...classifyWall(pts) }))
      .filter((w) => w.kind !== 'none');
    // Pick the WIDEST left-leaning wall and the WIDEST right-leaning
    // wall — those are the front-LEFT (long primary face) and front-
    // RIGHT (short receding face) wall polys.  Other left/right
    // candidates (door, windows) are smaller.
    const leftWalls = walls.filter((w) => w.kind === 'left');
    const rightWalls = walls.filter((w) => w.kind === 'right');
    expect(
      leftWalls.length,
      'expected ≥ 1 front-LEFT iso wall poly (long primary face)',
    ).toBeGreaterThanOrEqual(1);
    expect(
      rightWalls.length,
      'expected ≥ 1 front-RIGHT iso wall poly (short receding face)',
    ).toBeGreaterThanOrEqual(1);
    const widestLeft = leftWalls.reduce((a, b) =>
      b.bottomLen > a.bottomLen ? b : a,
    );
    const widestRight = rightWalls.reduce((a, b) =>
      b.bottomLen > a.bottomLen ? b : a,
    );
    // Acceptance: the long PRIMARY face's bottom edge is at least 1.4×
    // the short receding face's bottom edge — the asymmetric-footprint
    // signature.  With footLX/footLZ = 0.62/0.38 = 1.63, this gives
    // a comfortable 1.4 floor that absorbs measurement slack.
    const ratio = widestLeft.bottomLen / widestRight.bottomLen;
    expect(
      ratio,
      `front-LEFT wall bottom-edge length must be ≥ 1.4× front-RIGHT ` +
        `(asymmetric iso footprint, S-503). got left=${widestLeft.bottomLen} ` +
        `right=${widestRight.bottomLen} ratio=${ratio}`,
    ).toBeGreaterThanOrEqual(1.4);
    // And the height/width ratio of front-LEFT must DIFFER from front-
    // RIGHT (the explicit acceptance brief).
    const leftRatio = widestLeft.h / widestLeft.bottomLen;
    const rightRatio = widestRight.h / widestRight.bottomLen;
    expect(
      Math.abs(leftRatio - rightRatio),
      `front-LEFT and front-RIGHT wall H/W ratios must differ ` +
        `(per S-503 acceptance: dimetric basis gives different ` +
        `aspect for the two visible faces). leftRatio=${leftRatio} ` +
        `rightRatio=${rightRatio}`,
    ).toBeGreaterThan(0.3);
  });
});

describe('§K1 (S-497) — house body has iso-skewed wall + roof polys', () => {
  // The S-467 pass shipped a flat front-elevation rect+triangle on top
  // of an iso plinth. Live judge-iter94-solo-init.png showed all four
  // house roofs facing camera head-on as flat triangles. S-497 re-
  // authors the body as a true iso 3/4 box: front-right + front-left
  // wall faces are receding parallelograms, and the roof has two
  // visible slope faces meeting at a ridge apex. This test locks the
  // contract so a regression to flat front elevation fails CI.

  /** Returns true if the polygon has at least one edge that is neither
   *  purely horizontal nor purely vertical — i.e. a "skewed" edge. A
   *  flat g.rect() polygon has all edges axis-aligned, so this returns
   *  false. An iso parallelogram has two horizontal-ish edges and two
   *  diagonal edges, so this returns true. */
  function hasSkewedEdge(pts: number[]): boolean {
    if (pts.length < 6) return false;
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const x0 = pts[i * 2]!;
      const y0 = pts[i * 2 + 1]!;
      const x1 = pts[((i + 1) % n) * 2]!;
      const y1 = pts[((i + 1) % n) * 2 + 1]!;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      // An edge is "skewed" if it has both non-trivial dx AND non-
      // trivial dy. A vertical edge has dx≈0; a horizontal edge has
      // dy≈0. Use a 0.5-px floor to absorb rounding in the iso basis
      // (ISO_SIN = 0.5 is exact, so the diagonals are integer-clean).
      if (dx > 0.5 && dy > 0.5) return true;
    }
    return false;
  }

  /** Bounding box of a 4-vertex poly. */
  function bbox(pts: number[]): { w: number; h: number } {
    const xs = [pts[0]!, pts[2]!, pts[4]!, pts[6]!];
    const ys = [pts[1]!, pts[3]!, pts[5]!, pts[7]!];
    return {
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }

  test('body emits ≥ 2 iso-skewed wall parallelograms (front-right + front-left faces)', () => {
    const house = new House({
      ownerId: 'iso-wall-test',
      ownerName: 'iso',
      width: 200,
      height: 200,
    });
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    const polys = extractDiamondCandidates(bodyG);
    // We expect at minimum:
    //   • the iso plinth diamond (4-vertex, IS axis-aligned at the
    //     front/right/back/left corners — passes isIsoDiamond)
    //   • the plinth highlight halves (3-vertex triangles — filtered
    //     out by polys.length === 8 in extractDiamondCandidates)
    //   • the plinth side-skirts (4-vertex, ARE skewed parallelograms)
    //   • the front-RIGHT wall face (4-vertex, skewed parallelogram)
    //   • the front-LEFT wall face (4-vertex, skewed parallelogram)
    //   • door + window frames + cross-plank + sashes + stoop (more
    //     skewed parallelograms)
    // Acceptance: at least 2 wall-sized skewed parallelograms whose
    // bbox width ≥ 50 (rules out the small door/window pieces).
    const wallSized = polys.filter((p) => {
      const b = bbox(p);
      return b.w >= 50 && hasSkewedEdge(p);
    });
    expect(
      wallSized.length,
      `expected ≥ 2 wall-sized iso-skewed polys (front-right + front-left ` +
        `faces); got ${wallSized.length}. polys=${JSON.stringify(polys)}`,
    ).toBeGreaterThanOrEqual(2);
  });

  test('body has NO axis-aligned wall rect (regression: no flat front-elevation)', () => {
    // Pre-S-497 House.ts called g.rect(bodyX, bodyY, bodyW, bodyH) for
    // the wall shadow + g.rect(bodyX+6, bodyY+4, bodyW-12, bodyH-6)
    // for the wall front. Pixi 8 expands rect() into a 4-vertex poly
    // with axis-aligned edges and bbox.w ≈ bodyW = 156 (200 * 0.78)
    // and bbox.h ≈ bodyH = 110 (200 * 0.55). After S-497 those rects
    // are gone — replaced with iso-skewed parallelograms via
    // worldToScreen()-style basis. Lock that no large axis-aligned
    // rect remains on the body.
    const house = new House({
      ownerId: 'iso-no-flat-rect-test',
      ownerName: 'flat',
      width: 200,
      height: 200,
    });
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    const polys = extractDiamondCandidates(bodyG);
    const flatLargeRects = polys.filter((p) => {
      const b = bbox(p);
      // A flat wall rect is large (bbox.w ≥ 50) AND has NO skewed edges.
      return b.w >= 50 && b.h >= 50 && !hasSkewedEdge(p);
    });
    expect(
      flatLargeRects.length,
      `regression: house body must NOT contain a large axis-aligned ` +
        `rect (flat front-elevation wall). Found: ${JSON.stringify(flatLargeRects)}`,
    ).toBe(0);
  });

  test('roof slope polys are 3-vertex triangles meeting at an apex (not a head-on isoceles triangle)', () => {
    // The pre-S-497 roof was a 3-vertex isoceles triangle with a
    // horizontal base — both base corners shared the same y-coord.
    // The S-497 hipped iso roof has TWO visible slope triangles whose
    // 3 corners are: front_top (at y = pH - wallH), side_top (at
    // y = -wallH), apex (above). The base edge of each slope (front_top
    // → side_top) is NOT horizontal: it slopes by pH = pW * ISO_SIN.
    // Lock that contract.
    const house = new House({
      ownerId: 'iso-roof-test',
      ownerName: 'roof',
      width: 200,
      height: 200,
    });
    const bodyG = house.view.children[0] as { context: { instructions: unknown[] } };
    // 3-vertex polys (triangles) — extract from path instructions.
    const triangles: number[][] = [];
    interface FillInstruction {
      action: 'fill' | 'cut';
      data: { path: { instructions: { action: string; data: unknown[] }[] } };
    }
    for (const ins of bodyG.context.instructions as FillInstruction[]) {
      if (ins.action !== 'fill') continue;
      const pathIns = ins.data?.path?.instructions ?? [];
      for (const p of pathIns) {
        if (p.action !== 'poly') continue;
        const pts = p.data[0] as number[] | undefined;
        if (Array.isArray(pts) && pts.length === 6) triangles.push(pts);
      }
    }
    // Expect ≥ 2 triangles on the body (front-right slope + front-left
    // slope). The plinth highlight halves are also triangles, so the
    // count is ≥ 4 in practice — the assertion is "at least the two
    // roof slopes exist."
    expect(triangles.length, 'no triangles on body').toBeGreaterThanOrEqual(2);
    // At least one of those triangles must have its tallest vertex
    // ABOVE the bbox of the plinth (y < 0 in the local frame, since
    // apex sits at y = -wallH - roofH while the plinth diamond spans
    // [-pH, +pH] = [~-43, +43] at width=200). Lock that a roof apex
    // exists.
    const hasApex = triangles.some((tri) => {
      const ys = [tri[1]!, tri[3]!, tri[5]!];
      const minY = Math.min(...ys);
      // bodyH = h * 0.55 = 110 — so apex y ≈ -110 - (200*0.4) = -190.
      // Use a generous threshold: any triangle vertex above y=-100
      // is "above the plinth," sufficient to indicate a real roof
      // apex (not just a plinth-side highlight).
      return minY < -100;
    });
    expect(
      hasApex,
      'roof slope triangles must have an apex vertex above y=-100 ' +
        '(i.e. lifted above the plinth — confirms hipped iso roof, ' +
        'not a flat front-facing isoceles triangle that sits in the ' +
        'wall plane).',
    ).toBe(true);
    // Also: the visible slope triangles must NOT be flat-base
    // isoceles. For a flat-base isoceles triangle, two vertices share
    // the same y. For the iso slope (front_top → side_top → apex),
    // all three y-coords are distinct (front_top.y = pH - wallH = -67,
    // side_top.y = -wallH = -110, apex.y = -190). Find at least one
    // triangle where all three y-coords are distinct AND none of the
    // three pair-y-deltas is zero.
    const hasIsoSkewedTriangle = triangles.some((tri) => {
      const ys = [tri[1]!, tri[3]!, tri[5]!];
      const d01 = Math.abs(ys[0]! - ys[1]!);
      const d12 = Math.abs(ys[1]! - ys[2]!);
      const d02 = Math.abs(ys[0]! - ys[2]!);
      // All three deltas non-trivial (no two vertices share y).
      return d01 > 1 && d12 > 1 && d02 > 1;
    });
    expect(
      hasIsoSkewedTriangle,
      'expected ≥ 1 iso-skewed roof triangle (no two vertices share ' +
        'the same y — i.e. NOT a flat-base head-on isoceles triangle).',
    ).toBe(true);
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
