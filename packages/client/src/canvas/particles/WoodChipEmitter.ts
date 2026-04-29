// WoodChipEmitter — wooden splinters that fly off the victim's house
// during CHOP (FINAL_GOAL §C3 third bullet, ≥ 12 chips with rotation +
// arc trajectory). Sharp sliver shapes in lumber-brown tones with very
// high vrot so they tumble.

import { Graphics } from 'pixi.js';
import { ParticleEmitter, rand, pick } from './Particle.js';
import type { Particle } from './Particle.js';

const WOOD_COLORS = [
  0x8b5a2b, // saddle brown
  0xa0703f, // light wood
  0x6b3f1a, // dark wood
  0xc9985e, // pale shaving
  0x5c3318, // walnut
] as const;

export class WoodChipEmitter extends ParticleEmitter {
  constructor() {
    super(48);
  }

  protected drawSprite(g: Graphics): void {
    // Sliver: 2-px wide rectangle, tall — at scale gives a chip shape
    // with a clear long-axis to read rotation from.
    g.rect(-1, -3, 2, 6).fill({ color: 0xffffff, alpha: 1 });
  }

  protected spawnOne(p: Particle, originX: number, originY: number): void {
    p.x = originX + rand(-10, 10);
    p.y = originY + rand(-6, 6);
    // Wide arc burst — chips fly mostly outward + up. Larger speed range
    // than dust/cloth so the silhouette feels percussive.
    const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
    const speed = rand(180, 420);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.rot = rand(-Math.PI, Math.PI);
    p.vrot = rand(-18, 18); // high tumble
    p.drag = 0.4;
    p.gravity = 1100;
    p.alpha0 = 1.0;
    p.life = rand(0.7, 1.2);
    const sx = rand(0.9, 1.6);
    const sy = rand(1.2, 2.4);
    p.view.scale.set(sx, sy);
    p.view.tint = pick(WOOD_COLORS);
  }
}
