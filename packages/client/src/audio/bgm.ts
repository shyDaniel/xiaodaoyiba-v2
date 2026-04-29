/**
 * BGM — three pentatonic ZzFX-driven loops with auto cross-fade between
 * lobby / battle / victory variants. FINAL_GOAL §D2.
 *
 * Why hand-crafted setInterval rather than full ZzFXM? ZzFXM expects a
 * tracker-exported song table; we want zero new dependencies and zero new
 * assets. Each variant is a 16-step lead + bass loop, played through the
 * shared `zzfx()` voice synth. The variants share a key (C major
 * pentatonic) so cross-fade between them is musically continuous.
 *
 * Cross-fade strategy: each variant has its own `gainNode` between the
 * voice and the AudioContext destination. setVariant() ramps the active
 * variant's gain from 0→target and the previous variant's gain from
 * target→0 over `CROSSFADE_MS` (default 400ms; well within FINAL_GOAL §D
 * "phase change cross-fades within 500ms"). For ZzFX voices we don't
 * actually own the per-note gain node; instead we shape the cross-fade by
 * scaling the per-tick `tap()` volume linearly between 0 and 1. The
 * audible effect is identical and we don't have to wrap zzfx().
 */

import { zzfx, isMuted, getCtx, onMuteChange } from './zzfx.js';

// ── Notes (Hz) for the C-major pentatonic in octaves 3–5 ────────────────
const C3 = 130.81;
const G3 = 196.0;
const A3 = 220.0;
const C4 = 261.63;
const D4 = 293.66;
const E4 = 329.63;
const G4 = 392.0;
const A4 = 440.0;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;

// ── Variant tracks ──────────────────────────────────────────────────────
// Each variant is a fixed 16-step pattern. `null` = rest. `lead` is the
// melody voice; `bass` is the lower octave anchor.

interface Track {
  lead: ReadonlyArray<number | null>;
  bass: ReadonlyArray<number | null>;
  /** Per-step duration. Lower = faster tempo. */
  stepMs: number;
  /** Voice tunings — lead/bass amplitudes and timbre tweaks. */
  leadVol: number;
  bassVol: number;
  /** Lead shape parameter (0=sin, 1=tri, 2=saw, 3=tan, 4=noise). */
  leadShape: number;
}

/** Calm pentatonic, slow tempo, low volume — for Landing/Lobby. */
const LOBBY: Track = {
  lead: [
    C5, null, G4, null, E4, null, G4, null,
    A4, null, E5, null, D5, null, G4, null,
  ],
  bass: [
    C4, null, null, null, G4, null, null, null,
    A4, null, null, null, D4, null, null, null,
  ],
  stepMs: 200,
  leadVol: 0.20,
  bassVol: 0.14,
  leadShape: 1,
};

/** Slightly tense, faster tempo, sharper lead — during Game phase. */
const BATTLE: Track = {
  lead: [
    C5, E5, G5, E5, A4, C5, E5, G4,
    G5, E5, C5, A4, G4, A4, C5, D5,
  ],
  bass: [
    C3, null, G3, null, A3, null, G3, null,
    C3, null, A3, null, G3, null, C3, null,
  ],
  stepMs: 150,
  leadVol: 0.22,
  bassVol: 0.18,
  leadShape: 2,
};

/** Uplifting flourish loop — auto-fades back to lobby after a few bars
 *  in normal flow, but kept short and tight here. */
const VICTORY: Track = {
  lead: [
    G4, C5, E5, G5, C5, E5, G5, null,
    A4, C5, E5, G5, C5, null, G5, null,
  ],
  bass: [
    C3, null, null, null, G3, null, null, null,
    A3, null, null, null, C3, null, G3, null,
  ],
  stepMs: 160,
  leadVol: 0.24,
  bassVol: 0.20,
  leadShape: 0,
};

const TRACKS: Record<BgmVariant, Track> = {
  lobby: LOBBY,
  battle: BATTLE,
  victory: VICTORY,
};

export type BgmVariant = 'lobby' | 'battle' | 'victory';

// ── Cross-fade state ────────────────────────────────────────────────────

const CROSSFADE_MS = 400;

interface FadeState {
  /** Track currently dispatched on each tick. */
  active: BgmVariant;
  /** Previous track (still receiving its tail of fade-out volume). */
  previous: BgmVariant | null;
  /** Per-tick fade ramp: 0..1 multiplier on `active`. */
  activeGain: number;
  /** 1..0 multiplier on `previous`. */
  previousGain: number;
  /** Fade ramp clock (ms since variant change). */
  fadeClock: number;
}

const fade: FadeState = {
  active: 'lobby',
  previous: null,
  activeGain: 0,
  previousGain: 0,
  fadeClock: 0,
};

// ── Loop state ──────────────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
/** Per-track step counters so each variant resumes mid-pattern after a
 *  short cross-fade rather than restarting from the downbeat. */
const stepCounters: Record<BgmVariant, number> = {
  lobby: 0,
  battle: 0,
  victory: 0,
};
/** Per-session user toggle. Tracks "do we want BGM playing right now". */
let wanted = false;
let muteUnsubscribe: (() => void) | null = null;

// Driver tempo: we tick at the *fastest* track's stepMs (battle) so the
// other tracks can subdivide. In practice every variant uses every Nth
// tick where N = round(stepMs/DRIVER_MS).
const DRIVER_MS = 50;

/** Emit one note via zzfx, scaling volume by the cross-fade gain. */
function emitNote(
  freq: number,
  vol: number,
  shape: number,
  isBass: boolean,
): void {
  if (vol <= 0.001) return;
  if (isBass) {
    // Triangle-ish low thump.
    zzfx(vol, 0.02, freq, 0.01, 0.12, 0.18, 2, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.06);
  } else {
    zzfx(vol, 0.02, freq, 0.01, 0.07, 0.12, shape, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.03);
  }
}

/** Decide whether a given track should fire on this driver tick. */
function trackTickDue(track: Track, lastDriverTick: number): boolean {
  const stepInterval = Math.max(DRIVER_MS, track.stepMs);
  const steps = Math.floor(lastDriverTick / stepInterval);
  const prevSteps = Math.floor((lastDriverTick - DRIVER_MS) / stepInterval);
  return steps !== prevSteps;
}

function dispatchTrack(variant: BgmVariant, gainScale: number): void {
  if (gainScale <= 0.001) return;
  const t = TRACKS[variant];
  const i = stepCounters[variant] % t.lead.length;
  const lead = t.lead[i];
  const bass = t.bass[i];
  if (lead != null) emitNote(lead, t.leadVol * gainScale, t.leadShape, false);
  if (bass != null) emitNote(bass, t.bassVol * gainScale, t.leadShape, true);
  stepCounters[variant] = (stepCounters[variant] + 1) % t.lead.length;
}

/** Logical clock (advanced by DRIVER_MS per tick). Decoupled from
 *  performance.now() so vitest fake timers correctly drive the cross-fade
 *  and the test suite asserts the §D2 ≤ 500ms budget without touching the
 *  Web Audio API. In production this is monotonic with wall-clock since
 *  setInterval(DRIVER_MS) drives both. */
let logicalClock = 0;

function tick(): void {
  if (isMuted()) return;
  const dt = DRIVER_MS;
  logicalClock += dt;

  // Advance fade clock and recompute gains.
  if (fade.previous != null) {
    fade.fadeClock = Math.min(CROSSFADE_MS, fade.fadeClock + dt);
    const k = fade.fadeClock / CROSSFADE_MS;
    fade.activeGain = k;
    fade.previousGain = 1 - k;
    if (fade.fadeClock >= CROSSFADE_MS) {
      fade.previous = null;
      fade.previousGain = 0;
      fade.activeGain = 1;
    }
  } else {
    // Fade-in for a freshly started loop with no prior variant.
    if (fade.activeGain < 1) {
      fade.activeGain = Math.min(1, fade.activeGain + dt / CROSSFADE_MS);
    }
  }

  // Per-driver tick, dispatch any track whose step is due. We compare
  // against the previous logicalClock value to detect step boundaries.
  for (const variant of ['lobby', 'battle', 'victory'] as const) {
    const track = TRACKS[variant];
    const due = trackTickDue(track, logicalClock);
    if (!due) continue;
    if (variant === fade.active) dispatchTrack(variant, fade.activeGain);
    else if (variant === fade.previous) dispatchTrack(variant, fade.previousGain);
  }
}

/** Start the BGM driver if not already running. Idempotent. */
function ensureDriver(): void {
  if (timer != null) return;
  timer = setInterval(tick, DRIVER_MS);
}

function stopDriver(): void {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  logicalClock = 0;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Begin BGM playback at the given variant. Idempotent — calling twice
 * with the same variant is a no-op. Must be invoked from a user gesture
 * the first time so the AudioContext can unlock.
 */
export function startBgm(variant: BgmVariant = 'lobby'): void {
  wanted = true;
  // Wake the AudioContext (no-op if already running or unavailable).
  getCtx();
  if (muteUnsubscribe == null) {
    muteUnsubscribe = onMuteChange((m) => {
      if (m) stopDriver();
      else if (wanted) ensureDriver();
    });
  }
  // Initial variant: snap, no cross-fade-in tail from a previous loop.
  if (timer == null) {
    fade.active = variant;
    fade.previous = null;
    fade.activeGain = 0;
    fade.previousGain = 0;
    fade.fadeClock = 0;
    stepCounters[variant] = 0;
  } else if (fade.active !== variant) {
    setVariant(variant);
  }
  if (!isMuted()) ensureDriver();
}

/**
 * Cross-fade to a different variant. If the requested variant is already
 * active and not fading, this is a no-op.
 */
export function setVariant(variant: BgmVariant): void {
  if (timer == null) {
    // Driver isn't running yet — treat as fresh start.
    startBgm(variant);
    return;
  }
  if (fade.active === variant && fade.previous == null) return;
  fade.previous = fade.active;
  fade.previousGain = fade.activeGain;
  fade.active = variant;
  fade.activeGain = 0;
  fade.fadeClock = 0;
  // Don't reset stepCounters[variant] — pick up where we left off so the
  // next loop iteration through this variant feels continuous if the user
  // toggles back.
}

/** Stop the BGM loop and forget any cross-fade. */
export function stopBgm(): void {
  wanted = false;
  stopDriver();
  fade.active = 'lobby';
  fade.previous = null;
  fade.activeGain = 0;
  fade.previousGain = 0;
  fade.fadeClock = 0;
  if (muteUnsubscribe != null) {
    muteUnsubscribe();
    muteUnsubscribe = null;
  }
}

/** True if startBgm() has been called and stopBgm() has not. */
export function isBgmWanted(): boolean {
  return wanted;
}

/** Currently-active variant (for tests / debug). */
export function getActiveVariant(): BgmVariant {
  return fade.active;
}

/** True while a cross-fade is in progress. Used by tests to assert the
 *  ramp completes within CROSSFADE_MS. */
export function isCrossfading(): boolean {
  return fade.previous != null;
}

/** Cross-fade duration in ms. Exposed so callers (and tests) can assert
 *  the FINAL_GOAL §D "within 500ms" guarantee. */
export const CROSSFADE_DURATION_MS = CROSSFADE_MS;
