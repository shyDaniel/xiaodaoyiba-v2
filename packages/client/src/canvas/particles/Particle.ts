// Shared particle infrastructure — pooled PIXI.Graphics with velocity,
// gravity, drag, alpha-fade, and rotation. Each emitter subclasses this
// to draw its own sprite shape and tune its physics.
//
// Pooling strategy: every emitter keeps a flat Particle[] array; spawn()
// reuses dead slots (alive=false) before allocating new ones. The
// emitter itself owns a single Container that holds every Graphics for
// that emitter, so a stage scene can mount/unmount one node per
// particle channel rather than thousands.

import { Container, Graphics } from 'pixi.js';

/** A single particle's mutable physics state. */
export interface Particle {
  view: Graphics;
  alive: boolean;
  /** Time since spawn, in seconds. */
  age: number;
  /** Lifetime in seconds. Particle dies (alive=false, view.visible=false)
   *  when age>=life. */
  life: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  /** Per-frame drag multiplier in 1/sec (e.g. 0.6 → vx *= exp(-0.6*dt)). */
  drag: number;
  /** Gravity in px/sec^2. */
  gravity: number;
  /** Alpha at age 0. Linearly fades to 0 at age=life. */
  alpha0: number;
}

/** Construct a Particle slot — view is created once and added to the
 *  emitter's container; the emitter calls draw() to fill it. */
export function makeParticle(): Particle {
  const view = new Graphics();
  view.visible = false;
  return {
    view,
    alive: false,
    age: 0,
    life: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    rot: 0,
    vrot: 0,
    drag: 0,
    gravity: 0,
    alpha0: 1,
  };
}

/** Step the physics for a single particle by `dtSec` seconds. Returns
 *  true while still alive. Caller must update view.x/y/rotation/alpha
 *  from the returned state — keeping that out of here keeps the hot
 *  loop branch-free. */
export function stepParticle(p: Particle, dtSec: number): boolean {
  if (!p.alive) return false;
  p.age += dtSec;
  if (p.age >= p.life) {
    p.alive = false;
    p.view.visible = false;
    return false;
  }
  // Drag: exponential decay (frame-rate-independent).
  if (p.drag > 0) {
    const k = Math.exp(-p.drag * dtSec);
    p.vx *= k;
    p.vy *= k;
  }
  // Gravity.
  p.vy += p.gravity * dtSec;
  // Position.
  p.x += p.vx * dtSec;
  p.y += p.vy * dtSec;
  p.rot += p.vrot * dtSec;
  return true;
}

/**
 * Base class every emitter extends. Subclass overrides `drawSprite()` to
 * paint into a fresh Graphics (called once per pool slot), `spawnOne()`
 * to seed physics+position for a freshly-spawned particle, and (optional)
 * `updateView()` if it wants extra per-frame visual logic beyond the
 * default position/rotation/alpha mapping.
 *
 * Lifetime: `view` is mounted into a Pixi parent by the host (GameStage).
 * `update(dtMs)` is called every tick from GameStage's app.ticker. The
 * emitter retains responsibility for drag/gravity/fade — the host only
 * routes time.
 */
export abstract class ParticleEmitter {
  /** Container that holds every particle Graphics. Parent (GameStage)
   *  adds this once on mount and never touches it again. */
  readonly view: Container;
  protected pool: Particle[] = [];
  /** Soft cap on simultaneously-alive particles per emitter. Spawns
   *  beyond the cap silently no-op — frame budget protection so an
   *  out-of-control caller can't melt the renderer. */
  protected maxAlive: number;

  constructor(maxAlive: number) {
    this.view = new Container();
    this.maxAlive = maxAlive;
  }

  /** Draw the static sprite shape into a freshly-allocated Graphics.
   *  Subclasses override; called once per pool slot. */
  protected abstract drawSprite(g: Graphics): void;

  /** Initialize physics for a freshly-spawned particle. `originX/Y` is
   *  in the same coordinate space as the emitter's view (typically the
   *  gameplay layer). Subclasses tune velocity/life/gravity here. */
  protected abstract spawnOne(p: Particle, originX: number, originY: number): void;

  /** Optional per-frame view update; default copies x/y/rotation and
   *  fades alpha linearly. Subclasses can extend. */
  protected updateView(p: Particle): void {
    p.view.x = p.x;
    p.view.y = p.y;
    p.view.rotation = p.rot;
    // Linear alpha fade — squared for slight ease-in fade-out feel.
    const t = p.age / p.life;
    const a = 1 - t;
    p.view.alpha = p.alpha0 * a * a;
  }

  /** Get the next available pool slot, allocating a new one (and its
   *  Graphics) lazily. Returns null if the soft cap is reached. */
  protected acquire(): Particle | null {
    let alive = 0;
    for (const p of this.pool) if (p.alive) alive++;
    if (alive >= this.maxAlive) return null;
    for (const p of this.pool) {
      if (!p.alive) {
        p.alive = true;
        p.age = 0;
        p.view.visible = true;
        return p;
      }
    }
    const fresh = makeParticle();
    this.drawSprite(fresh.view);
    this.view.addChild(fresh.view);
    fresh.alive = true;
    fresh.view.visible = true;
    this.pool.push(fresh);
    return fresh;
  }

  /** Spawn `count` particles emanating from (originX, originY) in the
   *  emitter's coordinate space. Quietly clamps to the soft cap. */
  spawn(count: number, originX: number, originY: number): void {
    for (let i = 0; i < count; i++) {
      const p = this.acquire();
      if (!p) return;
      this.spawnOne(p, originX, originY);
      // Apply initial view state immediately so the first frame doesn't
      // pop in at (0,0) before update().
      this.updateView(p);
    }
  }

  /** Step every alive particle by dtMs milliseconds. */
  update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const p of this.pool) {
      if (!p.alive) continue;
      if (stepParticle(p, dt)) this.updateView(p);
    }
  }

  /** Number of currently-alive particles (for tests / debug). */
  aliveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  /** Force every particle to die immediately (e.g. on stage teardown). */
  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.view.visible = false;
    }
  }

  /** Release resources. Call on unmount. */
  destroy(): void {
    for (const p of this.pool) {
      try {
        p.view.destroy();
      } catch {
        /* noop */
      }
    }
    this.pool = [];
    try {
      this.view.destroy({ children: true });
    } catch {
      /* noop */
    }
  }
}

/** Uniform random in [a, b). */
export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Pick one element of `arr` uniformly at random. */
export function pick<T>(arr: ReadonlyArray<T>): T {
  // Caller guarantees non-empty; index 0 fallback satisfies TS strict.
  const i = Math.floor(Math.random() * arr.length);
  return arr[i] ?? (arr[0] as T);
}
