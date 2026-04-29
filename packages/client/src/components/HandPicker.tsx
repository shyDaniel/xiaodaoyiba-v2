// HandPicker — Rock / Paper / Scissors button row. Pure presentational
// React; the parent page wires the click handlers to the local game store.
//
// Visual note: each button is a chunky "button" with thematic Chinese
// labels (石头/剪刀/布) plus the universal emoji for legibility. Hovering
// scales 1.05; pressing flashes gold for ≥ 200ms (visual feedback ≥ 200ms
// per the FINAL_GOAL "every action must have a transition" rule).

import { useState } from 'react';
import { toCss, palette } from '../palette.js';

export type RpsChoice = 'ROCK' | 'PAPER' | 'SCISSORS';

export interface HandPickerProps {
  /** Whether the picker is currently active (player may submit). */
  enabled: boolean;
  /** Last chosen value, highlighted while waiting for resolution. */
  value: RpsChoice | null;
  onPick: (choice: RpsChoice) => void;
}

type IconKind = 'rock' | 'paper' | 'scissors';

const OPTIONS: Array<{ key: RpsChoice; label: string; icon: IconKind; tint: number }> = [
  { key: 'ROCK', label: '石头', icon: 'rock', tint: 0x8a6a40 },
  { key: 'PAPER', label: '布', icon: 'paper', tint: 0xe8d4a8 },
  { key: 'SCISSORS', label: '剪刀', icon: 'scissors', tint: 0xc8c8d8 },
];

function HandIcon({ kind }: { kind: IconKind }): JSX.Element {
  // Hand-drawn pictograms (no emoji font dependency). 48×48 viewBox.
  const stroke = '#1a1208';
  const fill = '#fff2d4';
  if (kind === 'rock') {
    // A clenched fist: round palm + 4 stacked knuckles + thumb.
    return (
      <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true">
        <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M10 24 q0 -8 8 -10 l14 0 q8 0 8 8 l0 8 q0 10 -10 12 l-10 0 q-10 0 -10 -10 z" fill={fill} />
          <path d="M14 22 q4 -3 8 0 M22 22 q4 -3 8 0 M30 22 q4 -3 6 0" fill="none" />
          <path d="M11 27 l-3 -1 q-2 -1 -1 -3 l2 -3" fill={fill} />
        </g>
      </svg>
    );
  }
  if (kind === 'paper') {
    // Open palm — 4 fingers + thumb.
    return (
      <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true">
        <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill={fill}>
          <path d="M14 28 l0 -14 q0 -3 3 -3 q3 0 3 3 l0 12" />
          <path d="M20 26 l0 -16 q0 -3 3 -3 q3 0 3 3 l0 14" />
          <path d="M26 26 l0 -14 q0 -3 3 -3 q3 0 3 3 l0 14" />
          <path d="M32 28 l0 -10 q0 -3 3 -3 q3 0 3 3 l0 14 q0 12 -10 14 l-6 0 q-10 0 -12 -10 l-3 -8 q-1 -3 2 -4 q3 -1 4 2 z" />
        </g>
      </svg>
    );
  }
  // scissors — V of two fingers + folded fist.
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" aria-hidden="true">
      <g stroke={stroke} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill={fill}>
        <path d="M16 26 l-6 -16 q-1 -3 2 -4 q3 -1 4 2 l6 14" />
        <path d="M26 22 l4 -14 q1 -3 4 -2 q3 1 2 4 l-4 14" />
        <path d="M14 24 q-3 0 -4 4 q-2 8 4 12 l8 4 q10 4 14 -6 l2 -10 q1 -4 -3 -5 q-4 -1 -5 3 l-2 6 l-10 -6 z" />
      </g>
    </svg>
  );
}

export function HandPicker({ enabled, value, onPick }: HandPickerProps): JSX.Element {
  const [hover, setHover] = useState<RpsChoice | null>(null);
  const [pressed, setPressed] = useState<RpsChoice | null>(null);

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'stretch',
        justifyContent: 'center',
        padding: '0.5rem 0.5rem 0.75rem',
      }}
    >
      {OPTIONS.map((opt) => {
        const isPicked = value === opt.key;
        const isHover = hover === opt.key;
        const isPressed = pressed === opt.key;
        const bg = isPressed
          ? toCss(palette.uiGold)
          : isPicked
          ? toCss(palette.uiGold)
          : toCss(opt.tint);
        const border = isPicked
          ? toCss(palette.uiGoldDeep)
          : '#2a1a14';
        return (
          <button
            key={opt.key}
            type="button"
            disabled={!enabled}
            onMouseEnter={() => setHover(opt.key)}
            onMouseLeave={() => setHover(null)}
            onMouseDown={() => setPressed(opt.key)}
            onMouseUp={() => {
              setTimeout(() => setPressed(null), 220);
            }}
            onClick={() => {
              if (!enabled) return;
              setPressed(opt.key);
              setTimeout(() => setPressed(null), 220);
              onPick(opt.key);
            }}
            style={{
              flex: '0 1 110px',
              minWidth: 92,
              padding: '0.65rem 0.5rem 0.55rem',
              borderRadius: 14,
              background: bg,
              border: `3px solid ${border}`,
              color: '#1a1208',
              fontFamily:
                'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
              fontWeight: 800,
              fontSize: '1rem',
              letterSpacing: '0.05em',
              cursor: enabled ? 'pointer' : 'not-allowed',
              opacity: enabled ? 1 : 0.45,
              transform: isHover && enabled ? 'translateY(-3px) scale(1.03)' : 'translateY(0) scale(1)',
              transition: 'transform 180ms ease-out, background 180ms ease, box-shadow 180ms ease',
              boxShadow: isPicked
                ? '0 0 0 3px rgba(247,215,116,0.55), 0 6px 12px rgba(0,0,0,0.55)'
                : '0 4px 0 rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)',
            }}
            aria-label={`${opt.label} ${opt.key.toLowerCase()}`}
          >
            <div style={{ display: 'flex', justifyContent: 'center', lineHeight: 1 }}>
              <HandIcon kind={opt.icon} />
            </div>
            <div style={{ fontSize: '1.05rem', marginTop: 4 }}>{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}
