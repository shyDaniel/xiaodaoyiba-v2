// RpsGlyph — inline SVG rock/paper/scissors pictogram, designed to render
// identically across every browser and headless renderer. Used by the
// BattleLog `R{N}.rps  throws=[…]  winners=[…]` row in place of the
// ✊✋✌ emoji glyphs, which require system color-emoji fonts that are
// absent in headless Chromium and on Android Chrome subsets — those
// renderers paint .notdef tofu boxes instead. ARCHITECTURE.md forbids
// emoji in the chrome layer; this module is the chrome-side companion to
// `canvas/RevealGlyphs.ts` (Pixi-side) and shares the same drawing
// language as `HandPicker.tsx` so all three surfaces read consistently.
//
// Sentinel-token contract (parsed in BattleLog.tsx):
//   Producers (Game.tsx) embed `\u0001ROCK\u0001`, `\u0001PAPER\u0001`,
//   `\u0001SCISSORS\u0001` substrings in the LogEntry.text. The log row
//   splits on `\u0001`, replaces the choice tokens with <RpsGlyph/>, and
//   passes everything else to the existing actor colorizer. U+0001
//   (START OF HEADING) is in C0 control-character space, never appears
//   in narration text, and round-trips through React safely.

import type { RpsChoice } from '@xdyb/shared';

/** Sentinel control character (U+0001) that brackets a choice token in
 *  LogEntry.text. Producers concatenate `${TOKEN}${choice}${TOKEN}`. */
export const RPS_TOKEN_SENTINEL = '\u0001';

/** Build a sentinel-bracketed token for a given RPS choice. The producer
 *  side uses this so the BattleLog renderer can split + recognize it. */
export function rpsToken(choice: RpsChoice): string {
  return `${RPS_TOKEN_SENTINEL}${choice}${RPS_TOKEN_SENTINEL}`;
}

/** Parse a token's payload back to an RpsChoice, or null if the payload
 *  isn't one of the three known choices. */
export function parseRpsToken(payload: string): RpsChoice | null {
  if (payload === 'ROCK' || payload === 'PAPER' || payload === 'SCISSORS') {
    return payload;
  }
  return null;
}

export interface RpsGlyphProps {
  kind: RpsChoice;
  /** Pixel size of the rendered icon (square). Defaults to 18 — matches
   *  the BattleLog font cap-height so the icon sits inline with the
   *  surrounding text run. */
  size?: number;
  /** Outer stroke + accent color. Defaults to `currentColor` so the icon
   *  inherits the text color of its containing run. */
  color?: string;
  /** Inner fill color (palm / fist body). Defaults to a near-paper white
   *  so the silhouette reads against any log row background. */
  fill?: string;
}

/** Inline SVG pictogram for ROCK / PAPER / SCISSORS. The drawing language
 *  matches HandPicker's `HandIcon` (chunky rounded shapes, 48×48 viewBox)
 *  but is tuned for inline reading at ~18px — strokes are slightly
 *  thicker (3.0px) so the silhouette holds at small sizes. */
export function RpsGlyph({
  kind,
  size = 18,
  color = 'currentColor',
  fill = '#fff2d4',
}: RpsGlyphProps): JSX.Element {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    'aria-hidden': true,
  } as const;
  const stroke = color;
  const strokeWidth = 3;
  if (kind === 'ROCK') {
    return (
      <svg
        {...common}
        style={{ display: 'inline-block', verticalAlign: '-0.18em' }}
      >
        <g
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
        >
          <path
            d="M10 24 q0 -8 8 -10 l14 0 q8 0 8 8 l0 8 q0 10 -10 12 l-10 0 q-10 0 -10 -10 z"
            fill={fill}
          />
          <path
            d="M14 22 q4 -3 8 0 M22 22 q4 -3 8 0 M30 22 q4 -3 6 0"
            fill="none"
          />
          <path
            d="M11 27 l-3 -1 q-2 -1 -1 -3 l2 -3"
            fill={fill}
          />
        </g>
      </svg>
    );
  }
  if (kind === 'PAPER') {
    return (
      <svg
        {...common}
        style={{ display: 'inline-block', verticalAlign: '-0.18em' }}
      >
        <g
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={fill}
        >
          <path d="M14 28 l0 -14 q0 -3 3 -3 q3 0 3 3 l0 12" />
          <path d="M20 26 l0 -16 q0 -3 3 -3 q3 0 3 3 l0 14" />
          <path d="M26 26 l0 -14 q0 -3 3 -3 q3 0 3 3 l0 14" />
          <path d="M32 28 l0 -10 q0 -3 3 -3 q3 0 3 3 l0 14 q0 12 -10 14 l-6 0 q-10 0 -12 -10 l-3 -8 q-1 -3 2 -4 q3 -1 4 2 z" />
        </g>
      </svg>
    );
  }
  // SCISSORS — V of two fingers + folded fist. Same path family as the
  // HandPicker version so the row's icons and the picker's icons read as
  // a matched set.
  return (
    <svg
      {...common}
      style={{ display: 'inline-block', verticalAlign: '-0.18em' }}
    >
      <g
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        fill={fill}
      >
        <path d="M16 26 l-6 -16 q-1 -3 2 -4 q3 -1 4 2 l6 14" />
        <path d="M26 22 l4 -14 q1 -3 4 -2 q3 1 2 4 l-4 14" />
        <path d="M14 24 q-3 0 -4 4 q-2 8 4 12 l8 4 q10 4 14 -6 l2 -10 q1 -4 -3 -5 q-4 -1 -5 3 l-2 6 l-10 -6 z" />
      </g>
    </svg>
  );
}
