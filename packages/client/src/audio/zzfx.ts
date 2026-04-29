/**
 * ZzFX — Zuper Zmall Zound Zynth (v1.3.2 by Frank Force, MIT)
 *
 * Ported verbatim from v1 with the only deltas being:
 *  - localStorage key renamed `xdyb:muted` → `xdyb.muted` to match the v2
 *    Game.tsx persisted key (single source of truth across React + audio).
 *  - SafeAudioContext stub for jsdom — `getCtx()` returns null so the test
 *    suite (no Web Audio API) drives the muted/preset-name surface without
 *    touching the renderer.
 *
 * The 19 numeric parameters describe a tiny synth voice:
 *   volume, randomness, frequency, attack, sustain, release, shape,
 *   shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime,
 *   noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo,
 *   filter
 * (matching upstream lambda parameter order
 *  p,k,b,e,r,t,q,D,u,y,v,z,l,E,A,F,c,w,m,B,N).
 *
 * Reference: https://github.com/KilledByAPixel/ZzFX
 */

const STORAGE_MUTE_KEY = 'xdyb.muted';

let ctx: AudioContext | null = null;
let muted = readMuted();
const volume = 0.3;

const muteListeners = new Set<(v: boolean) => void>();

function readMuted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(STORAGE_MUTE_KEY) === '1';
}

function persistMuted(v: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_MUTE_KEY, v ? '1' : '0');
  } catch {
    /* ignore quota / privacy modes */
  }
}

/**
 * Lazily create or return the shared AudioContext. Must be called from a
 * user-initiated event handler the first time, otherwise Chrome/Safari
 * will keep it suspended.
 */
export function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Try to wake the context if it was paused by the autoplay policy. */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state !== 'running') {
    void c.resume().catch(() => {
      /* ignore — will retry on next gesture */
    });
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(v: boolean): void {
  if (muted === v) return;
  muted = v;
  persistMuted(v);
  for (const fn of muteListeners) fn(v);
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

/** Subscribe to mute changes. Returns an unsubscribe function. The bgm
 *  module wires its loop to this so cross-fades respect mute live, not
 *  just at next-tick. */
export function onMuteChange(fn: (v: boolean) => void): () => void {
  muteListeners.add(fn);
  return () => muteListeners.delete(fn);
}

/**
 * Render a short PCM buffer for the given ZzFX parameters and play it.
 * Honours the global mute and the autoplay-suspended state.
 */
export function zzfx(...params: (number | undefined)[]): void {
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  if (c.state !== 'running') {
    // Don't drop silently — try to resume; the next call will succeed.
    void c.resume().catch(() => {});
    return;
  }
  const samples = renderZzfx(params);
  if (!samples.length) return;
  const buffer = c.createBuffer(1, samples.length, 44100);
  buffer.getChannelData(0).set(samples);
  const src = c.createBufferSource();
  src.buffer = buffer;
  src.connect(c.destination);
  src.start();
}

/* eslint-disable */
// Faithful port of the upstream micro-renderer; intentionally dense to keep
// the math identical to the reference 1KB lambda. See header for params.
function renderZzfx(params: (number | undefined)[]): Float32Array {
  const [
    p = 1, k = 0.05, b = 220, e = 0, r = 0, t = 0.1, q = 0, D = 1, u = 0, y = 0,
    v = 0, z = 0, l = 0, E = 0, A = 0, F = 0, c = 0, w = 1, m = 0, B = 0, N = 0,
  ] = params;
  const M = Math;
  const d = 2 * M.PI;
  const R = 44100;
  const arr: number[] = [];
  let bb = b;
  let uu = u;
  let ee = e;
  let mm = m;
  let rr = r;
  let tt = t;
  let cc = c;
  let yy = y;
  let AA = A;
  let vv = v;
  let zz = z;
  let ll = l;
  let pp = p;
  let G = uu * 500 * d / R / R;
  uu = G;
  bb = bb * (1 - k + 2 * k * M.random()) * d / R;
  let C = bb;
  let g = 0;
  let H = 0;
  let a = 0;
  let n = 1;
  let I = 0;
  let J = 0;
  let f = 0;
  const h0 = N < 0 ? -1 : 1;
  const x0 = d * h0 * N * 2 / R;
  const L = M.cos(x0);
  const Z = M.sin;
  const K = Z(x0) / 4;
  const O = 1 + K;
  const X = -2 * L / O;
  const Y = (1 - K) / O;
  let P = (1 + h0 * L) / 2 / O;
  let Q = -(h0 + L) / O;
  let S = P;
  let T = 0;
  let U = 0;
  let V = 0;
  let W = 0;
  ee = R * ee + 9;
  mm *= R;
  rr *= R;
  tt *= R;
  cc *= R;
  yy *= 500 * d / R ** 3;
  AA *= d / R;
  vv *= d / R;
  zz *= R;
  ll = (R * ll) | 0;
  pp *= volume;
  const h = (ee + mm + rr + tt + cc) | 0;
  let s = 0;
  while (a < h) {
    if (!(++J % ((100 * F) | 0 || 1))) {
      f = q
        ? 1 < q
          ? 2 < q
            ? 3 < q
              ? 4 < q
                ? ((g / d) % 1 < D / 2 ? 1 : 0) * 2 - 1
                : Z(g ** 3)
              : M.max(M.min(M.tan(g), 1), -1)
            : 1 - ((2 * g / d) % 2 + 2) % 2
          : 1 - 4 * M.abs(M.round(g / d) - g / d)
        : Z(g);
      f =
        (ll ? 1 - B + B * Z((d * a) / ll) : 1) *
        (4 < q ? s : (f < 0 ? -1 : 1) * M.abs(f) ** D) *
        (a < ee
          ? a / ee
          : a < ee + mm
            ? 1 - ((a - ee) / mm) * (1 - w)
            : a < ee + mm + rr
              ? w
              : a < h - cc
                ? ((h - a - cc) / tt) * w
                : 0);
      f = cc
        ? f / 2 +
          (cc > a ? 0 : ((a < h - cc ? 1 : (h - a) / cc) * arr[(a - cc) | 0]!) / 2 / pp)
        : f;
      if (N) {
        W = S * T + Q * (T = U) + P * (U = f) - Y * V - X * (V = W);
        f = W;
      }
    }
    const x = bb * M.cos(AA * H++);
    g += x + x * E * Z(a ** 5);
    if (n && ++n > zz) {
      bb += vv;
      C += vv;
      n = 0;
    }
    if (!ll || ++I % ll) {
      bb = C;
      uu = G;
      n = n || 1;
    }
    arr[a++] = f * pp;
  }
  return Float32Array.from(arr);
}
/* eslint-enable */
