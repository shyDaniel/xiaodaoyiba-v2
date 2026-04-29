/**
 * Audio module acceptance tests — FINAL_GOAL §D1/§D2/§D3.
 *
 * jsdom has no Web Audio API, so we test:
 *   - mute persistence (localStorage round-trip + survives reload)
 *   - preset enumeration (the 9 names FINAL_GOAL §D1 mandates)
 *   - cross-fade variant transition lands within CROSSFADE_DURATION_MS
 *
 * The renderer itself short-circuits on `getCtx() === null`, so muted-
 * path play() is also covered (no AudioContext = no throw).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CROSSFADE_DURATION_MS,
  getActiveVariant,
  isBgmWanted,
  isCrossfading,
  isMuted,
  play,
  setMuted,
  setVariant,
  SFX,
  startBgm,
  stopBgm,
  toggleMuted,
} from './index.js';

describe('audio: zzfx mute + presets (FINAL_GOAL §D1, §D3)', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false);
    stopBgm();
  });

  afterEach(() => {
    stopBgm();
    setMuted(false);
    localStorage.clear();
  });

  it('persists mute state to localStorage under xdyb.muted', () => {
    setMuted(true);
    expect(isMuted()).toBe(true);
    expect(localStorage.getItem('xdyb.muted')).toBe('1');
    setMuted(false);
    expect(localStorage.getItem('xdyb.muted')).toBe('0');
  });

  it('toggleMuted flips and returns the new value', () => {
    expect(isMuted()).toBe(false);
    expect(toggleMuted()).toBe(true);
    expect(isMuted()).toBe(true);
    expect(toggleMuted()).toBe(false);
  });

  it('exposes the FINAL_GOAL §D1 named SFX presets', () => {
    const names = Object.keys(SFX).sort();
    // Mandatory names from FINAL_GOAL §D1.
    const required = [
      'tap',
      'reveal',
      'pull',
      'chop',
      'dodge',
      'thud',
      'victory',
      'defeat',
      'roundStart',
    ].sort();
    for (const r of required) expect(names).toContain(r);
  });

  it('play() while muted does not throw and does not touch AudioContext', () => {
    setMuted(true);
    expect(() => play('tap')).not.toThrow();
    expect(() => play('chop')).not.toThrow();
    expect(() => play('victory')).not.toThrow();
  });

  it('play() unmuted in jsdom (no AudioContext) does not throw', () => {
    setMuted(false);
    expect(() => play('tap')).not.toThrow();
    expect(() => play('reveal')).not.toThrow();
    expect(() => play('pull')).not.toThrow();
  });
});

describe('audio: BGM driver + cross-fade (FINAL_GOAL §D2)', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false);
    stopBgm();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    stopBgm();
    setMuted(false);
    localStorage.clear();
  });

  it('startBgm() starts in the requested variant and reports wanted=true', () => {
    expect(isBgmWanted()).toBe(false);
    startBgm('lobby');
    expect(isBgmWanted()).toBe(true);
    expect(getActiveVariant()).toBe('lobby');
  });

  it('cross-fade transitions within CROSSFADE_DURATION_MS budget', () => {
    startBgm('lobby');
    expect(getActiveVariant()).toBe('lobby');
    setVariant('battle');
    expect(getActiveVariant()).toBe('battle');
    expect(isCrossfading()).toBe(true);
    // Advance the driver past the cross-fade window. The driver ticks
    // every 50ms; advance comfortably past CROSSFADE_DURATION_MS.
    vi.advanceTimersByTime(CROSSFADE_DURATION_MS + 200);
    expect(isCrossfading()).toBe(false);
    expect(getActiveVariant()).toBe('battle');
    // FINAL_GOAL §D2 budget — cross-fade must be ≤ 500ms.
    expect(CROSSFADE_DURATION_MS).toBeLessThanOrEqual(500);
  });

  it('setVariant() to the same active variant is a no-op', () => {
    startBgm('battle');
    expect(getActiveVariant()).toBe('battle');
    setVariant('battle');
    expect(isCrossfading()).toBe(false);
  });

  it('stopBgm() halts the driver and clears the wanted flag', () => {
    startBgm('battle');
    expect(isBgmWanted()).toBe(true);
    stopBgm();
    expect(isBgmWanted()).toBe(false);
  });

  it('mute mid-loop halts the driver but preserves variant on resume', () => {
    startBgm('battle');
    setMuted(true);
    // While muted the driver must not be emitting notes — fast-forward
    // and assert no throw (the per-tick path exits early on isMuted()).
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(getActiveVariant()).toBe('battle');
    setMuted(false);
    // Driver may need to be reset on unmute; the audio module subscribes
    // to mute changes and re-arms ensureDriver(). After a few ticks the
    // active variant is still 'battle'.
    vi.advanceTimersByTime(200);
    expect(getActiveVariant()).toBe('battle');
  });
});

describe('audio: localStorage mute survives module reload (FINAL_GOAL §D3)', () => {
  beforeEach(() => {
    localStorage.clear();
    setMuted(false);
  });

  it('a value of "1" in xdyb.muted is read on next module init', async () => {
    localStorage.setItem('xdyb.muted', '1');
    // Re-import the module fresh — mimics a page reload. vitest provides
    // vi.resetModules + dynamic import for this scenario.
    vi.resetModules();
    const fresh = await import('./zzfx.js');
    expect(fresh.isMuted()).toBe(true);
  });

  it('a value of "0" in xdyb.muted reads as unmuted on next module init', async () => {
    localStorage.setItem('xdyb.muted', '0');
    vi.resetModules();
    const fresh = await import('./zzfx.js');
    expect(fresh.isMuted()).toBe(false);
  });
});
