// ConfettiEmitter — celebratory squares that swirl down on game victory
// (FINAL_GOAL §C3 fourth bullet, ≥ 32 squares, ≥ 3 colors, swirling
// fall). Bright primary palette, low gravity, sinusoidal x-drift via
// per-particle phase so they swirl rather than just drop.

import { Graphics } from 'pixi.js';
import { ParticleEmitter, rand, pick } from './Particle.js';
import type { Particle } from './Particle.js';

/** Bright party palette — 6 distinct hues so each batch reads as
 *  multi-colored even with a small spawn count. */
const CONFETTI_COLORS = [
  0xff5252, // red
  0xffd54f, // amber
  0x4fc3f7, // sky blue
  0x81c784, // green
  0xba68c8, // violet
  0xff8a65, // coral
] as const;

interface ConfettiParticle extends Particle {
  /** Per-particle horizontal swirl phase + amplitude — sampled at
   *  spawn, applied in updateView() so the path looks fluttery. */
  swirlPhase: number;
  swirlAmp: number;
  swirlFreq: number;
  baseX: number;
}

export class ConfettiEmitter extends ParticleEmitter {
  constructor() {
    super(96);
  }

  protected drawSprite(g: Graphics): void {
    g.rect(-0.5, -0.5, 1, 1).fill({ color: 0xffffff, alpha: 1 });
  }

  protected spawnOne(p: Particle, originX: number, originY: number): void {
    const cp = p as ConfettiParticle;
    cp.x = originX + rand(-220, 220);
    cp.y = originY + rand(-30, 10);
    cp.baseX = cp.x;
    cp.vx = rand(-40, 40);
    cp.vy = rand(-180, -40);
    cp.rot = rand(-Math.PI, Math.PI);
    cp.vrot = rand(-6, 6);
    cp.drag = 0.4;
    cp.gravity = 320; // light gravity for a slow, swirly fall
    cp.alpha0 = 1.0;
    cp.life = rand(1.6, 2.6);
    cp.swirlPhase = rand(0, Math.PI * 2);
    cp.swirlAmp = rand(14, 36);
    cp.swirlFreq = rand(1.5, 3.2);
    const sx = rand(5, 9);
    const sy = rand(5, 9);
    cp.view.scale.set(sx, sy);
    cp.view.tint = pick(CONFETTI_COLORS);
  }

  protected override updateView(p: Particle): void {
    const cp = p as ConfettiParticle;
    // Sinusoidal sway around the integrated baseX (which we keep in
    // step with vx), so the visible x is base + swirl(t).
    cp.baseX += cp.vx * 0; // placeholder — vx is integrated already by stepParticle into p.x
    const sway = Math.sin(cp.swirlPhase + cp.age * cp.swirlFreq) * cp.swirlAmp;
    cp.view.x = cp.x + sway;
    cp.view.y = cp.y;
    cp.view.rotation = cp.rot;
    const t = cp.age / cp.life;
    // Hold full alpha most of the life, then fade in the last 25%.
    const a = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
    cp.view.alpha = cp.alpha0 * a;
  }
}
