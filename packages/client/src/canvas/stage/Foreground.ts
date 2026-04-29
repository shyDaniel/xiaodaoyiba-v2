// Foreground decoration: hanging lantern + drifting leaves (parallax 130%).

import { Container, Graphics } from 'pixi.js';
import { palette } from '../../palette.js';

export class Foreground {
  readonly view: Container;
  private width: number;
  private height: number;
  private readonly lantern: Graphics;
  private readonly lanternRight: Graphics;
  private readonly leaves: Array<{ g: Graphics; vx: number; vy: number; rot: number; baseY: number }> = [];
  private elapsed = 0;

  constructor(width: number, height: number) {
    this.view = new Container();
    this.width = width;
    this.height = height;

    this.lantern = this.makeLantern();
    this.lanternRight = this.makeLantern();
    this.view.addChild(this.lantern);
    this.view.addChild(this.lanternRight);
    this.layoutLanterns();

    for (let i = 0; i < 6; i++) {
      const g = this.makeLeaf();
      g.position.set(((i * 200) + 80) % width, -40 - i * 30);
      this.view.addChild(g);
      this.leaves.push({
        g,
        vx: 18 + (i % 3) * 6,
        vy: 40 + (i % 4) * 8,
        rot: 0,
        baseY: g.position.y,
      });
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.layoutLanterns();
  }

  update(dtMs: number): void {
    this.elapsed += dtMs;
    // gentle lantern sway
    const sway = Math.sin(this.elapsed / 800) * 0.06;
    this.lantern.rotation = sway;
    this.lanternRight.rotation = -sway * 0.8;

    for (const leaf of this.leaves) {
      leaf.g.position.x += (leaf.vx * dtMs) / 1000;
      leaf.g.position.y += (leaf.vy * dtMs) / 1000;
      leaf.g.rotation += dtMs / 600;
      if (leaf.g.position.y > this.height + 40) {
        leaf.g.position.y = -40;
        leaf.g.position.x = Math.random() * this.width;
      }
      if (leaf.g.position.x > this.width + 40) {
        leaf.g.position.x = -40;
      }
    }
  }

  private layoutLanterns(): void {
    this.lantern.position.set(60, 18);
    this.lanternRight.position.set(this.width - 60, 18);
  }

  private makeLantern(): Graphics {
    const g = new Graphics();
    // rope
    g.rect(-1, 0, 2, 36).fill({ color: 0x281810 });
    // lantern body — red drum
    g.rect(-22, 36, 44, 56).fill({ color: 0x6a1818 });
    g.rect(-26, 36, 52, 6).fill({ color: 0x4a1010 });
    g.rect(-26, 86, 52, 6).fill({ color: 0x4a1010 });
    g.rect(-20, 38, 40, 52).fill({ color: 0xc83838 });
    // glow rim
    g.rect(-20, 60, 40, 8).fill({ color: 0xf7d774, alpha: 0.7 });
    // tassel
    g.rect(-1, 92, 2, 14).fill({ color: 0x281810 });
    g.poly([-6, 106, 6, 106, 4, 116, -4, 116]).fill({ color: palette.uiGold });
    return g;
  }

  private makeLeaf(): Graphics {
    const g = new Graphics();
    g.poly([0, -8, 6, 0, 0, 8, -6, 0]).fill({ color: 0x4a8030 });
    g.moveTo(0, -8).lineTo(0, 8).stroke({ color: 0x2a4a18, width: 1 });
    return g;
  }
}
