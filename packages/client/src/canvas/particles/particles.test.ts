// Particle smoke tests — verify pool acquisition, lifetime expiry, and
// the per-emitter spawn counts FINAL_GOAL §C3 demands. Frame-budget
// proxy: 4 simultaneous spawns + 32 ms of ticking must complete under
// 16 ms of wall-clock time on a typical CI host.
//
// jsdom does not implement WebGL so we never instantiate a Pixi
// Application here — we only test the pure physics integration and the
// pool's bookkeeping. Pixi's Graphics + Container constructors do work
// in jsdom (they only allocate JS objects).

import { describe, it, expect } from 'vitest';
import {
  DustEmitter,
  ClothEmitter,
  WoodChipEmitter,
  ConfettiEmitter,
} from './index.js';
import { stepParticle, makeParticle } from './Particle.js';

describe('particle physics primitive', () => {
  it('integrates position with gravity', () => {
    const p = makeParticle();
    p.alive = true;
    p.life = 1;
    p.x = 0;
    p.y = 0;
    p.vx = 100;
    p.vy = 0;
    p.gravity = 980;
    // 100ms step.
    const live = stepParticle(p, 0.1);
    expect(live).toBe(true);
    // dx = 100 * 0.1 = 10
    expect(p.x).toBeCloseTo(10, 5);
    // vy = 0 + 980 * 0.1 = 98; y = 0 + 98 * 0.1 = 9.8 (Euler)
    expect(p.vy).toBeCloseTo(98, 5);
    expect(p.y).toBeCloseTo(9.8, 5);
  });

  it('expires when age >= life', () => {
    const p = makeParticle();
    p.alive = true;
    p.life = 0.5;
    expect(stepParticle(p, 0.4)).toBe(true);
    expect(stepParticle(p, 0.2)).toBe(false);
    expect(p.alive).toBe(false);
  });
});

describe('DustEmitter', () => {
  it('spawns at least 8 motes per RUSH step', () => {
    const e = new DustEmitter();
    e.spawn(8, 100, 200);
    expect(e.aliveCount()).toBe(8);
  });

  it('respects soft cap on alive particles', () => {
    const e = new DustEmitter();
    // Cap is 64; ask for 200 — only 64 should land.
    e.spawn(200, 0, 0);
    expect(e.aliveCount()).toBe(64);
  });

  it('expires motes within their lifetime budget (≤ 1s)', () => {
    const e = new DustEmitter();
    e.spawn(8, 0, 0);
    expect(e.aliveCount()).toBe(8);
    // Step 1.2s in 50ms increments — every mote should be dead by then.
    for (let t = 0; t < 1200; t += 50) e.update(50);
    expect(e.aliveCount()).toBe(0);
  });
});

describe('ClothEmitter', () => {
  it('spawns ≥ 12 scraps for a PULL_PANTS burst', () => {
    const e = new ClothEmitter();
    e.spawn(12, 0, 0);
    expect(e.aliveCount()).toBe(12);
  });
});

describe('WoodChipEmitter', () => {
  it('spawns ≥ 12 chips with rotation initialized', () => {
    const e = new WoodChipEmitter();
    e.spawn(12, 0, 0);
    expect(e.aliveCount()).toBe(12);
    // At least one chip should have non-trivial vrot (tumble).
    let anyTumble = false;
    for (const p of (e as unknown as { pool: { vrot: number; alive: boolean }[] }).pool) {
      if (p.alive && Math.abs(p.vrot) > 1) {
        anyTumble = true;
        break;
      }
    }
    expect(anyTumble).toBe(true);
  });
});

describe('ConfettiEmitter', () => {
  it('spawns ≥ 32 squares for victory', () => {
    const e = new ConfettiEmitter();
    e.spawn(32, 400, 200);
    expect(e.aliveCount()).toBe(32);
  });

  it('uses ≥ 3 distinct colors across a 32-spawn burst', () => {
    const e = new ConfettiEmitter();
    e.spawn(32, 400, 200);
    const tints = new Set<number>();
    for (const p of (e as unknown as { pool: { view: { tint: number }; alive: boolean }[] }).pool) {
      if (p.alive) tints.add(p.view.tint);
    }
    // 6 colors in palette × 32 picks → effectively always ≥ 3 distinct.
    expect(tints.size).toBeGreaterThanOrEqual(3);
  });
});

describe('frame budget — 4 emitters firing simultaneously', () => {
  it('completes one tick under 16 ms with all 4 channels saturated', () => {
    const dust = new DustEmitter();
    const cloth = new ClothEmitter();
    const chips = new WoodChipEmitter();
    const confetti = new ConfettiEmitter();
    dust.spawn(64, 0, 0);
    cloth.spawn(48, 0, 0);
    chips.spawn(48, 0, 0);
    confetti.spawn(96, 0, 0);
    expect(dust.aliveCount() + cloth.aliveCount() + chips.aliveCount() + confetti.aliveCount()).toBe(
      64 + 48 + 48 + 96,
    );
    const t0 = performance.now();
    dust.update(16);
    cloth.update(16);
    chips.update(16);
    confetti.update(16);
    const dt = performance.now() - t0;
    // Generous margin for CI noise. Pure JS integration over 256 particles
    // should complete in well under 2ms; 16ms is the §C3 acceptance.
    expect(dt).toBeLessThan(16);
  });
});
