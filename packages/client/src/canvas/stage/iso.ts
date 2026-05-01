// Iso projection helpers — FINAL_GOAL §K1.
//
// v6 raises the camera from a flat side-view to an isometric / top-down
// 45° projection, the look used by Hades, Stardew Valley, Don't Starve,
// Bastion, and Pyre. We adopt the standard 2:1 dimetric variant (the
// modern indie iso default) where:
//
//   * Horizontal (X / right) moves +x screen-right and +y screen-down.
//   * Depth (Z / into-the-scene) moves -x screen-left and +y screen-up.
//
// In the 2:1 dimetric form the world axes map onto the screen as:
//
//     X-axis = ( cos(30°) ,  sin(30°) ) · TILE_W      (right + slightly down)
//     Z-axis = (-cos(30°) ,  sin(30°) ) · TILE_W      (left  + slightly down)
//     Y-axis = ( 0        , -1        ) · TILE_H      (up)
//
// (We use Z-into-scene = +z, screen-up; "depth" reads from the bottom of
// the stage toward the horizon at the top.)  The classic iso skew that
// Pixi can apply via `Container.skew`/`scale` is the *equivalent* affine
// transform of these basis vectors.  See `isoMatrix()` below.
//
// Characters and houses in v6 stay upright (sprite billboards) — only
// the GROUND tiles and depth shadows render in iso.  This is the
// modern Steam-indie compromise that keeps faces / nameplate text
// readable while the floor visibly tilts away toward the vanishing
// point.  Reference: Hades.

/** Half-angle of the iso projection. 30° is the standard 2:1 dimetric
 *  angle; values <30° flatten toward top-down, >30° tilt closer to
 *  side view.  Exported so tests can assert the chosen value. */
export const ISO_ANGLE_DEG = 30;
export const ISO_ANGLE_RAD = (ISO_ANGLE_DEG * Math.PI) / 180;

/** sin(30°) = 0.5 exactly — vertical compression of the iso plane.
 *  A unit-length floor tile drawn at (TILE_W, 0) in world coords lands
 *  at (TILE_W·cos30°, TILE_W·sin30°) on screen — i.e. the floor is
 *  squashed to 50% vertically, which is what makes it read as iso. */
export const ISO_SIN = Math.sin(ISO_ANGLE_RAD);
export const ISO_COS = Math.cos(ISO_ANGLE_RAD);

export interface IsoPoint {
  x: number;
  y: number;
}

/** 2D affine matrix in row-major form: [a c tx; b d ty]. Matches
 *  PixiJS's Matrix `(a, b, c, d, tx, ty)` convention, which is the
 *  same as DOMMatrix's `setMatrixValue`.  Returned from `isoMatrix()`
 *  so callers can `Container.setFromMatrix(...)` if they choose to
 *  apply the iso transform via Pixi's transform system. */
export interface IsoMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

/** The iso transform matrix (2:1 dimetric).  Maps world (wx, wz) onto
 *  screen (sx, sy) with sx = wx*cos − wz*cos, sy = wx*sin + wz*sin.
 *  For a Pixi container whose children are laid out in world coords,
 *  applying this matrix produces a parallelogram floor with vanishing
 *  point straight up. */
export function isoMatrix(originX = 0, originY = 0): IsoMatrix {
  return {
    a: ISO_COS,
    b: ISO_SIN,
    c: -ISO_COS,
    d: ISO_SIN,
    tx: originX,
    ty: originY,
  };
}

/** Project a world (X going right, Z going INTO the scene) point to
 *  screen coords. Y (vertical / character height) is added at the end
 *  unscaled so a 128-px-tall character sprite stays 128 px tall on
 *  screen — only the floor tilts. */
export function worldToScreen(
  wx: number,
  wz: number,
  wy = 0,
  originX = 0,
  originY = 0,
): IsoPoint {
  return {
    x: originX + (wx - wz) * ISO_COS,
    y: originY + (wx + wz) * ISO_SIN - wy,
  };
}

/** Project a screen (sx, sy) point to world (wx, wz) on the floor
 *  plane (assumes wy=0). Inverse of `worldToScreen`. Useful for
 *  picking which tile a click landed on. */
export function screenToWorld(
  sx: number,
  sy: number,
  originX = 0,
  originY = 0,
): { wx: number; wz: number } {
  const dx = sx - originX;
  const dy = sy - originY;
  // Inverse of [cos -cos; sin sin].  determinant = 2·sin·cos.
  const det = 2 * ISO_SIN * ISO_COS;
  const wx = (dy * ISO_COS + dx * ISO_SIN) / det;
  const wz = (dy * ISO_COS - dx * ISO_SIN) / det;
  return { wx, wz };
}

/** Compute the four screen-space corners of a square iso floor tile of
 *  side `tileW` whose near-bottom corner sits at world (wx, wz).
 *  Returned in clockwise order starting from the screen-top corner so
 *  Pixi `Graphics.poly([...])` paints a parallelogram.  This is the
 *  primitive Ground.ts uses to render the iso tile grid. */
export function isoTilePoly(
  wx: number,
  wz: number,
  tileW: number,
  originX = 0,
  originY = 0,
): number[] {
  // Tile spans wx → wx+tileW in X, wz → wz+tileW in Z.
  const a = worldToScreen(wx, wz, 0, originX, originY); // bottom corner (front)
  const b = worldToScreen(wx + tileW, wz, 0, originX, originY); // right corner
  const c = worldToScreen(wx + tileW, wz + tileW, 0, originX, originY); // top corner (back)
  const d = worldToScreen(wx, wz + tileW, 0, originX, originY); // left corner
  return [a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y];
}
