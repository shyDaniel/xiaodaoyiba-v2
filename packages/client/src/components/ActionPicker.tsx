// ActionPicker — winner-agency action overlay (FINAL_GOAL §H3/§H4).
//
// Mounted by the parent page when the local human is among the round
// winners and either:
//   - the chosen target's stage allows multiple actions, OR
//   - the winner's own stage === ALIVE_PANTS_DOWN, in which case the
//     SELF action 穿好裤衩 (PULL_OWN_PANTS_UP) becomes selectable.
//
// Buttons:
//   - 扒裤衩 PULL_PANTS — yellow, target ALIVE_CLOTHED
//   - 咔嚓 CHOP — red, target ALIVE_PANTS_DOWN
//   - 穿好裤衩 PULL_OWN_PANTS_UP — cyan, self-action when winner pants_down
//
// Time budget shared with TargetPicker (caller orchestrates the 5s
// total); we run an independent countdown inside the picker so missing
// the deadline emits onPick(null) and the parent falls back to engine
// auto-pick.

import { useEffect, useState } from 'react';
import type { ActionKind } from '@xdyb/shared';
import { palette, toCss } from '../palette.js';

export interface ActionPickerProps {
  /** Pre-action winner stage so we can offer 穿好裤衩 when applicable. */
  winnerStage: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN';
  /** Pre-action target stage (undefined = no loser was chosen, e.g.
   *  PULL_OWN_PANTS_UP-only path). */
  targetStage?: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN';
  /** Total budget in ms before the picker times out. 0 disables timeout
   *  (used in unit tests). */
  timeoutMs?: number;
  /** Fired with the chosen action, or null on timeout. */
  onPick: (action: ActionKind | null) => void;
}

interface Option {
  kind: ActionKind;
  label: string;
  /** Sub-label rendered below; explains the verb in plain language. */
  hint: string;
  bg: string;
  fg: string;
  border: string;
  /** Visible only when this predicate returns true. */
  available: (
    winnerStage: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN',
    targetStage: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN' | undefined,
  ) => boolean;
}

const OPTIONS: ReadonlyArray<Option> = [
  {
    kind: 'PULL_PANTS',
    label: '扒裤衩',
    hint: '把对方的裤衩扒下来',
    bg: '#f7d774',
    fg: '#1a1208',
    border: '#6a4012',
    available: (_w, t) => t === 'ALIVE_CLOTHED',
  },
  {
    kind: 'CHOP',
    label: '咔嚓',
    hint: '一刀直接砍下！',
    bg: '#d04848',
    fg: '#fff',
    border: '#5a1010',
    available: (_w, t) => t === 'ALIVE_PANTS_DOWN',
  },
  {
    kind: 'PULL_OWN_PANTS_UP',
    label: '穿好裤衩',
    hint: '蹲下来把自己的裤衩穿好',
    bg: '#7ad1d8',
    fg: '#102228',
    border: '#1d4850',
    available: (w) => w === 'ALIVE_PANTS_DOWN',
  },
];

const COUNTDOWN_TICK_MS = 100;

export function ActionPicker({
  winnerStage,
  targetStage,
  timeoutMs = 5000,
  onPick,
}: ActionPickerProps): JSX.Element | null {
  const [remaining, setRemaining] = useState(timeoutMs);
  const [picked, setPicked] = useState<ActionKind | null>(null);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    if (picked !== null) return;
    const start = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const left = Math.max(0, timeoutMs - elapsed);
      setRemaining(left);
      if (left <= 0) {
        window.clearInterval(id);
        onPick(null);
      }
    }, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [timeoutMs, picked, onPick]);

  const visible = OPTIONS.filter((o) => o.available(winnerStage, targetStage));
  if (visible.length === 0) return null;

  const handleClick = (kind: ActionKind): void => {
    if (picked !== null) return;
    setPicked(kind);
    onPick(kind);
  };

  const pct = timeoutMs > 0 ? (remaining / timeoutMs) * 100 : 100;

  return (
    <div
      role="dialog"
      aria-label="选一个动作"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 20,
        background: 'rgba(11,13,18,0.94)',
        border: `3px solid ${toCss(palette.uiGold)}`,
        borderRadius: 18,
        padding: '18px 22px 16px',
        boxShadow:
          '0 12px 36px rgba(0,0,0,0.65), 0 0 0 6px rgba(247,215,116,0.18)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'auto',
        animation: 'xdyb-pulse-gold 1400ms ease-in-out infinite',
        maxWidth: 'min(92vw, 520px)',
      }}
    >
      <div
        style={{
          color: toCss(palette.uiGold),
          fontWeight: 800,
          fontSize: '1.05rem',
          letterSpacing: '0.18em',
          textShadow: '0 2px 0 #6a4012',
        }}
      >
        你赢了 · 选一个动作
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        {visible.map((opt) => {
          const isPicked = picked === opt.kind;
          return (
            <button
              key={opt.kind}
              type="button"
              onClick={() => handleClick(opt.kind)}
              disabled={picked !== null && !isPicked}
              data-testid={`action-${opt.kind}`}
              style={{
                minWidth: 130,
                padding: '12px 16px 10px',
                borderRadius: 14,
                background: opt.bg,
                color: opt.fg,
                border: `3px solid ${opt.border}`,
                fontWeight: 800,
                fontSize: '1rem',
                letterSpacing: '0.05em',
                cursor: picked !== null ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                boxShadow: isPicked
                  ? '0 0 0 3px rgba(247,215,116,0.7)'
                  : '0 4px 0 rgba(0,0,0,0.6)',
                transform: isPicked ? 'scale(1.05)' : 'scale(1)',
                transition: 'transform 160ms ease-out, box-shadow 160ms',
                opacity: picked !== null && !isPicked ? 0.6 : 1,
              }}
            >
              <span style={{ fontSize: '1.1rem' }}>{opt.label}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  opacity: 0.85,
                }}
              >
                {opt.hint}
              </span>
            </button>
          );
        })}
      </div>
      {timeoutMs > 0 ? (
        <div
          aria-label="countdown"
          style={{
            width: '100%',
            height: 6,
            borderRadius: 3,
            background: 'rgba(247,215,116,0.18)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: toCss(palette.uiGold),
              transition: `width ${COUNTDOWN_TICK_MS}ms linear`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
