// Iso projection unit tests — FINAL_GOAL §K1.
//
// These lock in the 2:1 dimetric contract used by the v6 ground plane:
//
//   * angle = 30° (the standard Hades / Stardew iso angle).
//   * sin(30°) = 0.5 so the floor is squashed to half height vertically.
//   * X-axis (right) and Z-axis (into-scene) project to mirrored screen
//     vectors that read as a parallelogram floor.
//   * Round-tripping through worldToScreen → screenToWorld is an identity
//     on the floor plane (within float epsilon).
//   * isoTilePoly produces a 4-corner parallelogram whose diagonals
//     align vertically and horizontally — i.e. a true iso diamond.

import { describe, expect, it } from 'vitest';
import {
  ISO_ANGLE_DEG,
  ISO_COS,
  ISO_SIN,
  isoMatrix,
  isoTilePoly,
  screenToWorld,
  worldToScreen,
} from './iso.js';

describe('iso constants', () => {
  it('uses the 2:1 dimetric 30° angle', () => {
    expect(ISO_ANGLE_DEG).toBe(30);
    expect(ISO_SIN).toBeCloseTo(0.5, 6);
    expect(ISO_COS).toBeCloseTo(Math.sqrt(3) / 2, 6);
  });
});

describe('isoMatrix', () => {
  it('produces the standard iso transform matrix', () => {
    const m = isoMatrix();
    // X-axis (1, 0) maps to ( cos, sin)
    expect(m.a).toBeCloseTo(ISO_COS, 6);
    expect(m.b).toBeCloseTo(ISO_SIN, 6);
    // Z-axis (0, 1) maps to (-cos, sin)
    expect(m.c).toBeCloseTo(-ISO_COS, 6);
    expect(m.d).toBeCloseTo(ISO_SIN, 6);
  });

  it('translation honors the supplied origin', () => {
    const m = isoMatrix(640, 400);
    expect(m.tx).toBe(640);
    expect(m.ty).toBe(400);
  });
});

describe('worldToScreen', () => {
  it('origin maps to origin', () => {
    const p = worldToScreen(0, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('+X (right) projects right and slightly down', () => {
    const p = worldToScreen(100, 0);
    // (100*cos, 100*sin) = (~86.6, 50)
    expect(p.x).toBeCloseTo(100 * ISO_COS, 4);
    expect(p.y).toBeCloseTo(100 * ISO_SIN, 4);
  });

  it('+Z (into scene) projects left and slightly down', () => {
    const p = worldToScreen(0, 100);
    expect(p.x).toBeCloseTo(-100 * ISO_COS, 4);
    expect(p.y).toBeCloseTo(100 * ISO_SIN, 4);
  });

  it('Y (vertical) lifts upward without affecting x', () => {
    const p = worldToScreen(50, 50, 100);
    const flat = worldToScreen(50, 50, 0);
    expect(p.x).toBeCloseTo(flat.x, 6);
    // +y world is screen-up, so screen-y decreases by exactly the y delta.
    expect(p.y).toBeCloseTo(flat.y - 100, 6);
  });

  it('vanishing point is straight up — equal +X and +Z move screen straight down', () => {
    // Walking diagonally INTO the scene (wx=wz=t, t increasing) should
    // keep us on the screen vertical center axis.
    const a = worldToScreen(0, 0);
    const b = worldToScreen(50, 50);
    const c = worldToScreen(200, 200);
    expect(b.x).toBeCloseTo(a.x, 4);
    expect(c.x).toBeCloseTo(a.x, 4);
    // And screen-y increases (depth into-scene goes down on our orientation).
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
  });
});

describe('screenToWorld', () => {
  it('round-trips through worldToScreen on the floor plane', () => {
    const cases = [
      { wx: 0, wz: 0 },
      { wx: 100, wz: 0 },
      { wx: 0, wz: 100 },
      { wx: 200, wz: 350 },
      { wx: -120, wz: 80 },
    ];
    for (const { wx, wz } of cases) {
      const s = worldToScreen(wx, wz, 0, 640, 400);
      const inv = screenToWorld(s.x, s.y, 640, 400);
      expect(inv.wx).toBeCloseTo(wx, 4);
      expect(inv.wz).toBeCloseTo(wz, 4);
    }
  });
});

describe('isoTilePoly', () => {
  it('emits 4 (x,y) corners of an iso diamond', () => {
    const poly = isoTilePoly(0, 0, 100);
    expect(poly).toHaveLength(8);

    // Corners in clockwise screen order:
    //   p0 = (0,0)        — bottom (front)   screen y = 0
    //   p1 = (tileW, 0)   — right            screen x positive
    //   p2 = (tileW,tileW)— top (back)       screen y largest negative
    //   p3 = (0, tileW)   — left             screen x negative
    // (note: in our orientation, +Z goes "down" on screen so back is
    // larger y, not smaller — verify by inspecting the y order.)
    const [x0, y0, x1, y1, x2, y2, x3, y3] = poly as [
      number, number, number, number, number, number, number, number,
    ];
    // Diamond axes: opposite corners have the same x or the same y.
    // Bottom (p0) and top (p2) sit on the same vertical line — i.e. the
    // diamond's vertical diagonal is x-axis-aligned.
    expect(x0).toBeCloseTo(x2, 4);
    // Right (p1) and left (p3) sit on the same horizontal line.
    expect(y1).toBeCloseTo(y3, 4);
    // y2 (back corner) is below y0 (front corner): wx+wz=200 > 0 →
    // larger screen-y.
    expect(y2).toBeGreaterThan(y0);
    // x1 (right) > x3 (left)
    expect(x1).toBeGreaterThan(x3);
  });
});
