// DustEmitter — gritty puffs that kick up from the actor's feet during
// RUSH (FINAL_GOAL §C3 first bullet, ≥ 8 motes per step). Tan/grey
// translucent circles with low gravity, high drag, short life so they
// puff and settle.

import { Graphics } from 'pixi.js';
import { ParticleEmitter, rand, pick } from './Particle.js';
import type { Particle } from './Particle.js';

/** Tan/grey palette tuned to read on both the dirt road and grass tufts.
 *  Pre-blended values (no per-particle tint allocation). */
const DUST_COLORS = [0xc7b598, 0xa89576, 0x8a7a5e, 0xd6c8af] as const;

export class DustEmitter extends ParticleEmitter {
  constructor() {
    super(64);
  }

  protected drawSprite(g: Graphics): void {
    // Soft circle — radius small (3–5), drawn once per pool slot then
    // tinted at spawn via Graphics.tint.
    g.circle(0, 0, 1).fill({ color: 0xffffff, alpha: 0.85 });
  }

  protected spawnOne(p: Particle, originX: number, originY: number): void {
    p.x = originX + rand(-12, 12);
    p.y = originY + rand(-2, 4);
    // Mostly upward + outward; the actor's facing direction is encoded
    // by the caller passing a slight x-bias via originX (we just give a
    // symmetric burst here — the visual is small enough that asymmetry
    // doesn't read).
    const angle = rand(-Math.PI * 0.85, -Math.PI * 0.15);
    const speed = rand(60, 180);
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.rot = rand(0, Math.PI * 2);
    p.vrot = rand(-2, 2);
    p.drag = 1.6;
    p.gravity = 280;
    p.alpha0 = rand(0.55, 0.85);
    p.life = rand(0.45, 0.85);
    // Per-spawn size + color (set on the view directly so the pool's
    // base sprite stays a unit circle).
    const r = rand(3, 6);
    p.view.scale.set(r);
    p.view.tint = pick(DUST_COLORS);
  }
}
