// Camera + ScreenShake unit tests.
//
// These exercise the FINAL_GOAL §C4 contract:
//
//   * shake({amp:8,  ms:80})   STRIKE — produces non-zero offset that
//                              decays to zero in <= 80ms.
//   * shake({amp:16, ms:200})  KO     — sustained for 200ms with larger
//                                       per-tick magnitude than STRIKE.
//   * zoomTo(attacker, 1.0→1.1, 600ms, easeOut) — scale tween that
//     reaches 1.1 at 600ms, never overshoots.
//   * Per-layer parallax differential — sky (0.1) translates 10% of
//     gameplay (1.0) when the camera shakes.
//
// jsdom is fine — Pixi Container only allocates JS, no GL.

import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import { Camera } from './Camera.js';
import { ScreenShake } from './ScreenShake.js';

/** Deterministic mulberry32 RNG so shake offsets are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ScreenShake', () => {
  it('STRIKE shake produces a non-zero offset that decays inside 80ms', () => {
    const s = new ScreenShake();
    s.shake({ amp: 8, ms: 80, axis: 'y', rng: rng(1) });

    // Sample at the start: must be non-zero somewhere in the first ~16ms.
    const o0 = s.update(8);
    expect(Math.abs(o0.x) + Math.abs(o0.y)).toBeGreaterThan(0);
    // Y-biased shake: x should always be 0.
    expect(o0.x).toBe(0);

    // Drive a full 80ms more — shake should be dead and offset zero.
    s.update(80);
    expect(s.activeCount()).toBe(0);
    const oDone = s.update(16);
    expect(oDone.x).toBe(0);
    expect(oDone.y).toBe(0);
  });

  it('KO shake (16, 200) lasts longer with larger peak than STRIKE', () => {
    const sStrike = new ScreenShake();
    const sKo = new ScreenShake();
    sStrike.shake({ amp: 8, ms: 80, axis: 'xy', rng: rng(2) });
    sKo.shake({ amp: 16, ms: 200, axis: 'x', rng: rng(2) });

    // Sample many small steps and capture peak |offset|.
    let peakStrike = 0;
    let peakKo = 0;
    for (let t = 0; t < 200; t += 4) {
      const a = sStrike.update(4);
      const b = sKo.update(4);
      peakStrike = Math.max(peakStrike, Math.abs(a.x) + Math.abs(a.y));
      peakKo = Math.max(peakKo, Math.abs(b.x) + Math.abs(b.y));
    }
    // KO peak should clearly exceed STRIKE peak.
    expect(peakKo).toBeGreaterThan(peakStrike);
    // STRIKE expired well before KO.
    expect(sStrike.activeCount()).toBe(0);
    // KO expired after exactly 200ms (we drove 200ms).
    expect(sKo.activeCount()).toBe(0);
  });

  it('shakes superpose additively (KO during a STRIKE ringdown)', () => {
    const s = new ScreenShake();
    s.shake({ amp: 8, ms: 80, axis: 'x', rng: rng(3) });
    s.update(20);
    expect(s.activeCount()).toBe(1);
    s.shake({ amp: 16, ms: 200, axis: 'x', rng: rng(4) });
    expect(s.activeCount()).toBe(2);
    s.update(80);
    // STRIKE was at 20ms when KO started; another 80ms = 100ms total →
    // STRIKE expired at 80ms. KO is at 80ms / 200ms still alive.
    expect(s.activeCount()).toBe(1);
  });

  it('clear() drops every active shake', () => {
    const s = new ScreenShake();
    s.shake({ amp: 8, ms: 80 });
    s.shake({ amp: 16, ms: 200 });
    s.clear();
    expect(s.activeCount()).toBe(0);
    const o = s.update(16);
    expect(o.x).toBe(0);
    expect(o.y).toBe(0);
  });

  it('linear amplitude decay reaches zero at the duration boundary', () => {
    const s = new ScreenShake();
    // Use deterministic rng that returns 1 (so rx/ry = 1) → offset = amp * t.
    s.shake({ amp: 10, ms: 100, axis: 'x', rng: () => 1 });
    // Halfway through: offset weight = 0.5.
    const o1 = s.update(50);
    // x = (1*2 - 1) * 10 * 0.5 = 5
    expect(o1.x).toBeCloseTo(5, 5);
    // Drive to the boundary.
    s.update(50);
    expect(s.activeCount()).toBe(0);
  });
});

describe('Camera zoomTo', () => {
  it('reaches the target scale at exactly the duration boundary', () => {
    const cam = new Camera();
    cam.zoomTo(0, 0, 1.1, 600, 'out');
    // Drive in 60 fps-ish steps for 600ms.
    for (let t = 0; t < 600; t += 16) cam.update(16);
    cam.update(16); // crosses the boundary
    expect(cam.getScale()).toBeCloseTo(1.1, 4);
    expect(cam.isZooming()).toBe(false);
  });

  it('ease-out: scale at 50% elapsed exceeds linear midpoint', () => {
    const cam = new Camera();
    cam.zoomTo(0, 0, 1.1, 600, 'out');
    cam.update(300);
    // Linear midpoint would be 1.05. Ease-out (1 - (1-t)^2) at t=0.5
    // gives 0.75 → scale ≈ 1.075. So the actual scale is > 1.05.
    expect(cam.getScale()).toBeGreaterThan(1.05);
    expect(cam.getScale()).toBeLessThan(1.1);
  });

  it('linear ease hits exactly the linear midpoint', () => {
    const cam = new Camera();
    cam.zoomTo(0, 0, 1.1, 600, 'linear');
    cam.update(300);
    expect(cam.getScale()).toBeCloseTo(1.05, 4);
  });

  it('zero-ms zoom is applied instantly', () => {
    const cam = new Camera();
    cam.zoomTo(0, 0, 1.5, 0);
    expect(cam.getScale()).toBe(1.5);
    expect(cam.isZooming()).toBe(false);
  });

  it('reset() returns scale to 1.0 and clears tweens', () => {
    const cam = new Camera();
    cam.zoomTo(0, 0, 1.1, 600);
    cam.update(50);
    cam.reset();
    expect(cam.getScale()).toBe(1.0);
    expect(cam.isZooming()).toBe(false);
  });
});

describe('Camera per-layer parallax + scale', () => {
  it('translate is scaled per-layer parallax factor', () => {
    const sky = new Container();
    const gameplay = new Container();
    const fg = new Container();
    // Use a deterministic shaker that emits offset = (amp, amp).
    const shaker = new ScreenShake();
    // Patch update to deterministic behavior: install a fake shake that
    // returns +amp on both axes via rng=()=>1.
    shaker.shake({ amp: 10, ms: 1000, axis: 'xy', rng: () => 1 });

    const cam = new Camera(shaker);
    cam.addLayer({ container: sky, parallax: 0.1, zooms: false });
    cam.addLayer({ container: gameplay, parallax: 1.0 });
    cam.addLayer({ container: fg, parallax: 1.3 });

    cam.update(0); // 0ms → t weight = 1; rx=ry=1 → offset = (10, 10).

    // Sky: 0.1 * 10 = 1
    expect(sky.position.x).toBeCloseTo(1, 4);
    expect(sky.position.y).toBeCloseTo(1, 4);
    // Gameplay: 1.0 * 10 = 10
    expect(gameplay.position.x).toBeCloseTo(10, 4);
    expect(gameplay.position.y).toBeCloseTo(10, 4);
    // Foreground: 1.3 * 10 = 13
    expect(fg.position.x).toBeCloseTo(13, 4);
    expect(fg.position.y).toBeCloseTo(13, 4);
  });

  it('non-zooming layer keeps scale = 1 regardless of camera zoom', () => {
    const sky = new Container();
    const gameplay = new Container();
    const cam = new Camera();
    cam.addLayer({ container: sky, parallax: 0.1, zooms: false });
    cam.addLayer({ container: gameplay, parallax: 1.0 });
    cam.zoomTo(0, 0, 1.1, 0); // instant
    cam.update(0);
    expect(sky.scale.x).toBeCloseTo(1, 4);
    expect(gameplay.scale.x).toBeCloseTo(1.1, 4);
  });

  it('zooming gameplay layer scales by exactly camera scale', () => {
    const gameplay = new Container();
    const cam = new Camera();
    cam.addLayer({ container: gameplay, parallax: 1.0 });
    cam.zoomTo(0, 0, 1.1, 0);
    cam.update(0);
    expect(gameplay.scale.x).toBeCloseTo(1.1, 4);
    expect(gameplay.scale.y).toBeCloseTo(1.1, 4);
  });
});
