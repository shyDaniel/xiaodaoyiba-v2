// Background layer: sky gradient + sun + drifting clouds (parallax 10%).
//
// Pure PixiJS Graphics — no external assets, so this works on any clean
// install. The sky uses a vertical gradient via a stack of Graphics
// rectangles (PixiJS 8 doesn't have native gradient fills on basic shapes
// without a fragment shader; stacked rects are visually equivalent at the
// scale we render).

import { Container, Graphics } from 'pixi.js';
import { palette } from '../../palette.js';

export interface BackgroundOptions {
  width: number;
  height: number;
}

interface Cloud {
  graphic: Graphics;
  vx: number;
  baseY: number;
  drift: number;
}

export class Background {
  readonly view: Container;
  private readonly clouds: Cloud[] = [];
  private readonly sun: Graphics;
  private readonly sky: Graphics;
  private width: number;
  private height: number;
  private elapsed = 0;

  constructor(opts: BackgroundOptions) {
    this.view = new Container();
    this.width = opts.width;
    this.height = opts.height;

    this.sky = new Graphics();
    this.sun = new Graphics();
    this.view.addChild(this.sky);
    this.view.addChild(this.sun);

    // Build clouds (4 of them, at varied y offsets)
    const cloudYs = [0.12, 0.22, 0.32, 0.18];
    const cloudVx = [12, 8, 16, 10];
    for (let i = 0; i < 4; i++) {
      const g = this.makeCloud(48 + (i % 2) * 24);
      g.position.set(
        ((i * 360) % this.width) + 80,
        this.height * (cloudYs[i] ?? 0.2),
      );
      this.view.addChild(g);
      this.clouds.push({
        graphic: g,
        vx: cloudVx[i] ?? 10,
        baseY: g.position.y,
        drift: i * 1.7,
      });
    }

    this.draw();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.draw();
  }

  /** Animation tick. `dtMs` is milliseconds since the last frame. */
  update(dtMs: number): void {
    this.elapsed += dtMs;
    for (const cloud of this.clouds) {
      cloud.graphic.position.x += (cloud.vx * dtMs) / 1000;
      // wrap left/right with margin so they don't pop
      const margin = 200;
      if (cloud.graphic.position.x > this.width + margin) {
        cloud.graphic.position.x = -margin;
      }
      cloud.graphic.position.y =
        cloud.baseY + Math.sin((this.elapsed / 2000) + cloud.drift) * 4;
    }
    // gentle sun pulse
    const halo = 1 + Math.sin(this.elapsed / 1400) * 0.05;
    this.sun.scale.set(halo);
  }

  private draw(): void {
    // Vertical sky gradient via 32 stacked bands
    const sky = this.sky;
    sky.clear();
    const bands = 32;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const color = lerpColor3(
        palette.skyTop,
        palette.skyMid,
        palette.skyBottom,
        t,
      );
      sky.rect(0, (i * this.height) / bands, this.width, this.height / bands + 2)
        .fill({ color });
    }

    // Sun halo + body in the upper-right
    const sun = this.sun;
    sun.clear();
    const sx = this.width * 0.78;
    const sy = this.height * 0.18;
    // outer halo, soft
    sun.circle(0, 0, 110).fill({ color: palette.sunHalo, alpha: 0.18 });
    sun.circle(0, 0, 80).fill({ color: palette.sunHalo, alpha: 0.32 });
    sun.circle(0, 0, 56).fill({ color: palette.sun, alpha: 0.95 });
    sun.position.set(sx, sy);
  }

  private makeCloud(scale: number): Graphics {
    const g = new Graphics();
    // Stack of overlapping circles for a fluffy silhouette
    const blobs: Array<[number, number, number]> = [
      [0, 0, scale * 0.6],
      [scale * 0.7, -scale * 0.1, scale * 0.5],
      [-scale * 0.7, -scale * 0.05, scale * 0.55],
      [scale * 0.3, -scale * 0.25, scale * 0.4],
      [-scale * 0.25, -scale * 0.22, scale * 0.42],
    ];
    // shadow underbelly
    for (const [x, y, r] of blobs) {
      g.circle(x, y + r * 0.25, r).fill({ color: palette.cloudShadow });
    }
    for (const [x, y, r] of blobs) {
      g.circle(x, y, r).fill({ color: palette.cloud });
    }
    return g;
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

function lerpColor3(a: number, b: number, c: number, t: number): number {
  if (t < 0.5) return lerpColor(a, b, t * 2);
  return lerpColor(b, c, (t - 0.5) * 2);
}
