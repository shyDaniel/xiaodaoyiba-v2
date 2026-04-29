// Ground layer: a perspective-tinted dirt road with stripe accents.
// Parallax 100% (the gameplay-world plane).

import { Container, Graphics } from 'pixi.js';
import { palette } from '../../palette.js';

export class Ground {
  readonly view: Container;
  private width: number;
  private height: number;
  private readonly g: Graphics;

  /** Y coordinate (in world space) of the horizon — characters stand on this. */
  groundY = 0;

  constructor(width: number, height: number) {
    this.view = new Container();
    this.width = width;
    this.height = height;
    this.g = new Graphics();
    this.view.addChild(this.g);
    this.draw();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.draw();
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    const w = this.width;
    const h = this.height;
    const horizon = h * 0.62;
    this.groundY = h * 0.82;

    // Far ground band (tints to the horizon)
    g.rect(0, horizon, w, h - horizon).fill({ color: palette.groundDark });

    // Mid band — slight gradient via stacked rects
    const bands = 14;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const y = horizon + (h - horizon) * t;
      const bandH = (h - horizon) / bands + 1;
      const color = lerpColor(palette.groundDark, palette.groundLight, t);
      g.rect(0, y, w, bandH).fill({ color });
    }

    // Road stripe down the middle (perspective trapezoid)
    const roadColor = palette.roadStripe;
    const farLeft = w * 0.46;
    const farRight = w * 0.54;
    const nearLeft = w * 0.05;
    const nearRight = w * 0.95;
    g.poly([
      farLeft, horizon,
      farRight, horizon,
      nearRight, h,
      nearLeft, h,
    ]).fill({ color: palette.groundMid });

    // dashed center stripe
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      const t0 = i / stripes;
      const t1 = (i + 0.5) / stripes;
      const y0 = horizon + (h - horizon) * t0;
      const y1 = horizon + (h - horizon) * t1;
      const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
      const xL0 = lerp((farLeft + farRight) / 2 - 4, (nearLeft + nearRight) / 2 - 12, t0);
      const xR0 = lerp((farLeft + farRight) / 2 + 4, (nearLeft + nearRight) / 2 + 12, t0);
      const xL1 = lerp((farLeft + farRight) / 2 - 4, (nearLeft + nearRight) / 2 - 12, t1);
      const xR1 = lerp((farLeft + farRight) / 2 + 4, (nearLeft + nearRight) / 2 + 12, t1);
      g.poly([xL0, y0, xR0, y0, xR1, y1, xL1, y1]).fill({ color: roadColor });
    }

    // Subtle grass tufts at horizon (small triangles)
    for (let i = 0; i < 30; i++) {
      const x = (i / 30) * w + ((i * 41) % 23);
      const tuftY = horizon + 4 + ((i * 13) % 10);
      g.poly([
        x, tuftY,
        x - 4, tuftY + 6,
        x + 4, tuftY + 6,
      ]).fill({ color: 0x4a6028 });
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}
