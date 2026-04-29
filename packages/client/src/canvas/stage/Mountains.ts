// Mid-distance mountain layer (parallax 30%). Two ridges of triangular
// mountains with snow caps to give depth between sky and gameplay layer.

import { Container, Graphics } from 'pixi.js';
import { palette } from '../../palette.js';

export class Mountains {
  readonly view: Container;
  private width: number;
  private height: number;
  private readonly far: Graphics;
  private readonly near: Graphics;

  constructor(width: number, height: number) {
    this.view = new Container();
    this.width = width;
    this.height = height;
    this.far = new Graphics();
    this.near = new Graphics();
    this.view.addChild(this.far);
    this.view.addChild(this.near);
    this.draw();
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.draw();
  }

  private draw(): void {
    this.drawRidge(this.far, palette.mountainFar, 0.42, 0.6, 7, 36);
    this.drawRidge(this.near, palette.mountainNear, 0.5, 0.78, 5, 60);
  }

  private drawRidge(
    g: Graphics,
    color: number,
    yTop: number,
    yBase: number,
    peaks: number,
    capDepth: number,
  ): void {
    g.clear();
    const w = this.width;
    const h = this.height;
    const baseY = h * yBase;
    const minY = h * yTop;
    const points: number[] = [];
    points.push(-50, baseY);
    for (let i = 0; i <= peaks; i++) {
      const x = (i / peaks) * (w + 100) - 50;
      // alternating peak heights with slight randomization based on position
      const variation = 0.5 + 0.5 * Math.sin(i * 1.7 + color);
      const y = baseY - (baseY - minY) * (0.6 + 0.4 * variation);
      points.push(x, y);
    }
    points.push(w + 50, baseY);
    g.poly(points).fill({ color });

    // snow caps: draw small white triangles atop each peak
    for (let i = 1; i < points.length - 2; i += 2) {
      const x = points[i] ?? 0;
      const y = points[i + 1] ?? 0;
      // skip the start/end base anchors
      if (y >= baseY - 4) continue;
      const capW = 24;
      const capH = capDepth * 0.4;
      g.poly([
        x, y,
        x - capW, y + capH,
        x + capW, y + capH,
      ]).fill({ color: palette.mountainCap });
    }
  }
}
