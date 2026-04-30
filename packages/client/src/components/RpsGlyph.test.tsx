// RpsGlyph + BattleLog token rendering test (FINAL_GOAL §H2 / S-385).
//
// Why this test matters: prior iterations encoded the BattleLog rps row
// as `throws=[✊✋✌]` literal Unicode. Headless Chromium (and Android
// Chrome subsets without Noto Color Emoji) painted those code points as
// .notdef tofu boxes, breaking the §H2 acceptance test. The fix routes
// every choice through a sentinel token (`\u0001ROCK\u0001`) which the
// log renderer expands into an inline SVG icon — guaranteeing identical
// pixels across every browser and headless renderer.
//
// We assert: (1) tokens emitted by `rpsToken()` round-trip through
// `parseRpsToken()`, (2) BattleLog's LogRow expands each token into a
// real <svg> element in the rendered DOM, (3) the log row's text
// contains zero ✊✋✌ Unicode code points (no emoji slips through into
// the chrome layer), (4) actor colorization still works alongside the
// tokens.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BattleLog, type LogEntry } from './BattleLog.js';
import {
  rpsToken,
  parseRpsToken,
  RPS_TOKEN_SENTINEL,
} from './RpsGlyph.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('rpsToken / parseRpsToken', () => {
  it('emits sentinel-bracketed payloads that round-trip', () => {
    expect(rpsToken('ROCK')).toBe(`${RPS_TOKEN_SENTINEL}ROCK${RPS_TOKEN_SENTINEL}`);
    expect(rpsToken('PAPER')).toBe(`${RPS_TOKEN_SENTINEL}PAPER${RPS_TOKEN_SENTINEL}`);
    expect(rpsToken('SCISSORS')).toBe(`${RPS_TOKEN_SENTINEL}SCISSORS${RPS_TOKEN_SENTINEL}`);
    expect(parseRpsToken('ROCK')).toBe('ROCK');
    expect(parseRpsToken('PAPER')).toBe('PAPER');
    expect(parseRpsToken('SCISSORS')).toBe('SCISSORS');
    expect(parseRpsToken('LIZARD')).toBeNull();
    expect(parseRpsToken('')).toBeNull();
  });

  it('uses the U+0001 control character as the sentinel', () => {
    // Critical contract: U+0001 is in C0 control space, never appears in
    // narration text, and round-trips through React safely. If this
    // ever changes, the BattleLog token splitter must change in
    // lockstep.
    expect(RPS_TOKEN_SENTINEL).toBe('\u0001');
    expect(RPS_TOKEN_SENTINEL.length).toBe(1);
  });
});

describe('BattleLog R{N}.rps row token expansion', () => {
  function renderEntry(entry: LogEntry): void {
    act(() => {
      root.render(
        <BattleLog mode="desktop" entries={[entry]} />,
      );
    });
  }

  it('renders an inline <svg> for each choice token', () => {
    const text = `throws=[${rpsToken('ROCK')}${rpsToken('PAPER')}${rpsToken(
      'SCISSORS',
    )}${rpsToken('PAPER')}] winners=[${rpsToken('PAPER')}×2]`;
    const entry: LogEntry = {
      id: 'r1.rps',
      round: 1,
      phase: 'rps',
      verb: '掷',
      text,
      ts: Date.now(),
    };
    renderEntry(entry);
    const svgs = container.querySelectorAll('svg');
    // 5 choice tokens in the text → 5 inline RpsGlyph SVGs in the row.
    // (We don't pin to an exact count if other glyphs surface elsewhere
    // in the BattleLog chrome — gate on >= 5 to keep the test resilient
    // to future header decoration.)
    expect(svgs.length).toBeGreaterThanOrEqual(5);
    // Each <svg> must be a real, non-empty element with stroke paths —
    // guaranteeing the pixel renders (not just an empty <svg/> shell).
    for (const svg of Array.from(svgs)) {
      expect(svg.getAttribute('viewBox')).toBe('0 0 48 48');
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    }
  });

  it('emits zero ✊✋✌ Unicode code points in the rendered DOM', () => {
    // §H2 / ARCHITECTURE.md: "no emoji in the chrome layer". This is
    // the regression test that catches the original bug — even though
    // the DOM text said `throws=[✊✋✌]`, headless Chromium painted
    // tofu boxes for it.
    const text = `throws=[${rpsToken('ROCK')}${rpsToken('PAPER')}${rpsToken(
      'SCISSORS',
    )}]`;
    const entry: LogEntry = {
      id: 'r2.rps',
      round: 2,
      phase: 'rps',
      verb: '掷',
      text,
      ts: Date.now(),
    };
    renderEntry(entry);
    const dom = container.textContent ?? '';
    for (const emoji of ['\u270A', '\u270B', '\u270C']) {
      expect(dom.includes(emoji)).toBe(false);
    }
    // The sentinel must also be stripped — it is a control character
    // and would corrupt screen-reader output if left in.
    expect(dom.includes(RPS_TOKEN_SENTINEL)).toBe(false);
  });

  it('preserves actor colorization alongside the inline tokens', () => {
    const text = `小红 throws=[${rpsToken('ROCK')}] winners=[${rpsToken(
      'ROCK',
    )}×1]`;
    const entry: LogEntry = {
      id: 'r3.rps',
      round: 3,
      phase: 'rps',
      verb: '掷',
      text,
      actors: ['小红|p-red'],
      ts: Date.now(),
    };
    renderEntry(entry);
    const html = container.innerHTML;
    // Actor colorizer wraps the player name in an inline span with a
    // bold weight; if the new token-splitter regressed the colorizer,
    // 小红 would render as plain text instead.
    expect(html).toContain('小红');
    const named = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent === '小红' && s.getAttribute('style'),
    );
    expect(named).toBeDefined();
    const style = named?.getAttribute('style') ?? '';
    expect(style).toMatch(/font-weight:\s*700/);
    // And both choice tokens still rendered as <svg>s.
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2);
  });
});
