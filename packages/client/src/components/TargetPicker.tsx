// TargetPicker — winner-agency UI overlay (FINAL_GOAL §H3).
//
// Mounts on top of the GameStage when the local human is among the round
// winners and ≥ 2 eligible loser targets exist. Each candidate is a
// pulsing card showing the loser's nickname + a 选 prompt. The winner
// taps one to commit; the picker also auto-resolves on a 5s timeout
// using the engine's default first-loser rule (no choice = let auto-pick
// fall through). Bots never see this — the parent page only mounts the
// picker for human winners.
//
// Visual style mirrors HandPicker: chunky button, gold accent on hover,
// player-color stripe so the winner can scan and commit fast.

import { useEffect, useState } from 'react';
import { palette, playerColor, toCss } from '../palette.js';

export interface TargetCandidate {
  id: string;
  nickname: string;
  /** Pre-action stage so the parent can hint what would happen
   *  (扒 if clothed, 砍 if pants_down). */
  stage: 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN' | 'DEAD';
}

export interface TargetPickerProps {
  /** Loser candidates. Caller filters out DEAD + already-claimed. */
  candidates: ReadonlyArray<TargetCandidate>;
  /** Total budget in ms before the picker times out (default 5000 per
   *  §H3 spec). When 0, the picker shows a "已选" lock and cannot time
   *  out — used for unit testing. */
  timeoutMs?: number;
  /** Fired with the candidate's id when the user picks one, or null on
   *  timeout (parent should fall back to engine auto-pick). */
  onPick: (id: string | null) => void;
}

const COUNTDOWN_TICK_MS = 100;

export function TargetPicker({
  candidates,
  timeoutMs = 5000,
  onPick,
}: TargetPickerProps): JSX.Element | null {
  const [remaining, setRemaining] = useState(timeoutMs);
  const [picked, setPicked] = useState<string | null>(null);

  // Countdown — drains the budget every COUNTDOWN_TICK_MS until 0, at
  // which point we fire onPick(null) so the parent can fall back to
  // engine auto-pick. The interval is bound to the picker's lifetime
  // so unmounting (parent already received a pick) cancels it cleanly.
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

  if (candidates.length === 0) return null;

  const handleClick = (id: string): void => {
    if (picked !== null) return;
    setPicked(id);
    onPick(id);
  };

  const pct = timeoutMs > 0 ? (remaining / timeoutMs) * 100 : 100;

  return (
    <div
      role="dialog"
      aria-label="选一个目标"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 20,
        background: 'rgba(11,13,18,0.92)',
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
        选一个目标
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        {candidates.map((c) => {
          const accent = playerColor(c.id);
          const verb = c.stage === 'ALIVE_PANTS_DOWN' ? '砍' : '扒';
          const verbColor =
            c.stage === 'ALIVE_PANTS_DOWN' ? '#ff5454' : '#f7d774';
          const isPicked = picked === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => handleClick(c.id)}
              disabled={picked !== null && !isPicked}
              data-testid={`target-${c.id}`}
              style={{
                minWidth: 110,
                padding: '10px 14px 9px',
                borderRadius: 14,
                background: isPicked
                  ? toCss(palette.uiGold)
                  : 'rgba(11,13,18,0.85)',
                border: `3px solid ${toCss(accent)}`,
                color: isPicked ? '#1a1208' : '#f4ecd8',
                fontWeight: 800,
                fontSize: '0.95rem',
                letterSpacing: '0.05em',
                cursor: picked !== null ? 'default' : 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                boxShadow: isPicked
                  ? '0 0 0 3px rgba(247,215,116,0.55)'
                  : '0 4px 0 rgba(0,0,0,0.6)',
                transition: 'transform 160ms ease-out, background 160ms',
                transform: isPicked ? 'scale(1.04)' : 'scale(1)',
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: toCss(accent),
                  border: '2px solid #1a1208',
                }}
              />
              <span>{c.nickname}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  color: isPicked ? '#1a1208' : verbColor,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                }}
              >
                即将{verb}
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
