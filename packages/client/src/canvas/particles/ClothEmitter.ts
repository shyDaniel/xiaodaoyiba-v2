// ClothEmitter — small fabric scraps that fall from the victim's waist
// during PULL_PANTS (FINAL_GOAL §C3 second bullet, ≥ 12 scraps with
// gravity). Each scrap is a tiny rotated rectangle in pant-cloth tones
// (denim blue / khaki) with strong gravity + tumble.

import { Graphics } from 'pixi.js';
import { ParticleEmitter, rand, pick } from './Particle.js';
import type { Particle } from './Particle.js';

const CLOTH_COLORS = [
  0x3c5a8f, // denim blue
  0x4a6ea3, // light denim
  0x6b5b3a, // khaki brown
  0x8a7340, // tan khaki
  0x2e2a26, // dark trouser
] as const;

export class ClothEmitter extends ParticleEmitter {
  constructor() {
    super(48);
  }

  protected drawSprite(g: Graphics): void {
    // Unit rect; per-spawn we set scale.x/scale.y to give an irregular
    // "scrap" shape and tint to a denim/khaki value.
    g.rect(-0.5, -0.5, 1, 1).fill({ color: 0xffffff, alpha: 1 });
  }

  protected spawnOne(p: Particle, originX: number, originY: number): void {
    p.x = originX + rand(-14, 14);
    p.y = originY + rand(-4, 6);
    // Initial outward burst — sideways spray with mild upward kick so
    // they arc before falling.
    const sideways = rand(-260, 260);
    const upward = rand(-180, -40);
    p.vx = sideways;
    p.vy = upward;
    p.rot = rand(-Math.PI, Math.PI);
    p.vrot = rand(-9, 9);
    p.drag = 0.9;
    p.gravity = 900; // strong gravity so scraps fall convincingly
    p.alpha0 = rand(0.85, 1.0);
    p.life = rand(0.85, 1.4);
    const w = rand(5, 10);
    const h = rand(3, 7);
    p.view.scale.set(w, h);
    p.view.tint = pick(CLOTH_COLORS);
  }
}
