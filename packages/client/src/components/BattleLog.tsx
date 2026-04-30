// BattleLog — fixed right rail showing per-round narration. Each entry
// has timestamp prefix `R{N}.{phase}`, color-coded action badges, fade-in
// + 800ms yellow glow on new entries. Scrollable history.
//
// Responsive shell (S-342): on viewports < 768px the right rail is
// replaced by a bottom-sheet that defaults to collapsed. A floating
// toggle button anchored above the HandPicker lets the user expand the
// sheet to read narration, then collapse it again to free up the
// canvas. This restores the missing 200+px of canvas width on mobile so
// all 4 characters + the houses fit, and the HandPicker buttons are no
// longer clipped behind the rail.

import { useEffect, useRef, useState } from 'react';
import { toCss, palette, playerColor } from '../palette.js';
import {
  RpsGlyph,
  RPS_TOKEN_SENTINEL,
  parseRpsToken,
} from './RpsGlyph.js';

export type LogVerb = '扒' | '砍' | '闪' | '平' | '死' | '胜' | '穿' | '掷';

export interface LogEntry {
  id: string;
  round: number;
  phase: string; // e.g. 'pull_pants', 'tie', 'chop'
  verb: LogVerb;
  text: string;
  /** Player ids referenced (used for color hints). */
  actors?: string[];
  /** Timestamp for fade-in animation. */
  ts: number;
}

const VERB_COLOR: Record<LogVerb, number> = {
  扒: palette.uiPull,
  砍: palette.uiChop,
  闪: palette.uiDodge,
  平: palette.uiTie,
  死: palette.uiDeath,
  胜: 0x38c878,
  // FINAL_GOAL §H7: self-restore badge — cyan, distinct from the chop
  // red and the pull gold so the log reads "winner clothed themselves
  // back" at a glance.
  穿: 0x38c8d8,
  // FINAL_GOAL §H2: simultaneous-throw (REVEAL phase) row — neutral
  // slate so it reads as a "scoreboard" row distinct from action verbs.
  掷: 0x9aa3b2,
};

export interface BattleLogProps {
  entries: LogEntry[];
  /**
   * Force layout mode. Defaults to 'auto' which switches to the mobile
   * bottom-sheet at viewport widths < 768px and the desktop right-rail
   * otherwise.
   */
  mode?: 'auto' | 'desktop' | 'mobile';
  /**
   * Bottom inset (in px) reserved for the parent footer / HandPicker.
   * The mobile toggle button is anchored this many pixels above the
   * viewport's bottom edge so it never overlaps the action bar.
   * Defaults to 132 (HandPicker height + safe-area).
   */
  mobileBottomOffset?: number;
}

export function BattleLog({
  entries,
  mode = 'auto',
  mobileBottomOffset = 132,
}: BattleLogProps): JSX.Element {
  const isMobile = useIsMobile(mode);
  if (isMobile) {
    return (
      <BattleLogMobile
        entries={entries}
        mobileBottomOffset={mobileBottomOffset}
      />
    );
  }
  return <BattleLogDesktop entries={entries} />;
}

function BattleLogDesktop({ entries }: { entries: LogEntry[] }): JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <aside
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(30vw, 360px)',
        minWidth: 240,
        background: 'rgba(11,13,18,0.96)',
        borderTopWidth: '0',
        borderRightWidth: '0',
        borderBottomWidth: '0',
        borderLeftWidth: '2px',
        borderStyle: 'solid',
        borderColor: 'rgba(247,215,116,0.35)',
        boxShadow: 'inset 12px 0 24px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 10,
      }}
    >
      <LogHeader />
      <LogList listRef={listRef} entries={entries} />
    </aside>
  );
}

function BattleLogMobile({
  entries,
  mobileBottomOffset,
}: {
  entries: LogEntry[];
  mobileBottomOffset: number;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Last-seen entry id used to drive a "new message" pulse on the
  // collapsed toggle button so the user notices narration arriving while
  // the sheet is closed.
  const [unread, setUnread] = useState(0);
  const lastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const last = entries[entries.length - 1];
    if (!last) return;
    if (lastIdRef.current === last.id) return;
    lastIdRef.current = last.id;
    if (open) {
      setUnread(0);
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      setUnread((n) => n + 1);
    }
  }, [entries, open]);

  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open]);

  const lastEntry = entries[entries.length - 1];

  return (
    <>
      {/* Floating toggle / mini-preview — visible whenever the sheet is
          collapsed. Sits above the HandPicker via the bottom offset. */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="展开战报"
          style={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: mobileBottomOffset,
            zIndex: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 12,
            background: 'rgba(11,13,18,0.92)',
            border: '2px solid rgba(247,215,116,0.55)',
            boxShadow:
              unread > 0
                ? '0 0 18px rgba(247,215,116,0.55), 0 4px 10px rgba(0,0,0,0.6)'
                : '0 4px 10px rgba(0,0,0,0.55)',
            color: '#f4ecd8',
            fontFamily:
              'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
            fontSize: '0.82rem',
            cursor: 'pointer',
            textAlign: 'left',
            animation:
              unread > 0
                ? 'xdyb-pulse-gold 1200ms ease-in-out infinite'
                : undefined,
          }}
        >
          <span
            style={{
              flex: '0 0 auto',
              color: toCss(palette.uiGold),
              fontWeight: 800,
              letterSpacing: '0.18em',
              fontSize: '0.78rem',
            }}
          >
            战报
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              opacity: lastEntry ? 1 : 0.55,
            }}
          >
            {lastEntry
              ? `R${lastEntry.round}.${lastEntry.phase} · ${lastEntry.text}`
              : '等待第一回合…'}
          </span>
          {unread > 0 ? (
            <span
              style={{
                flex: '0 0 auto',
                background: toCss(palette.uiGold),
                color: '#1a1208',
                borderRadius: 999,
                padding: '1px 7px',
                fontWeight: 800,
                fontSize: '0.7rem',
              }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
          <span
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              color: toCss(palette.uiGold),
              fontWeight: 800,
              fontSize: '0.9rem',
            }}
          >
            ▴
          </span>
        </button>
      ) : null}

      {open ? (
        <>
          {/* Backdrop — tapping outside collapses the sheet. */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 12,
            }}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-label="战报"
            style={{
              position: 'fixed',
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: '60vh',
              minHeight: 220,
              background: 'rgba(11,13,18,0.98)',
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              borderTop: '2px solid rgba(247,215,116,0.55)',
              boxShadow: '0 -8px 24px rgba(0,0,0,0.7)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              zIndex: 13,
              animation: 'xdyb-sheet-up 220ms ease-out',
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起战报"
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                padding: '0.7rem 0.9rem 0.4rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                color: '#f4ecd8',
                fontFamily:
                  'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
              }}
            >
              <span
                style={{
                  color: toCss(palette.uiGold),
                  fontWeight: 800,
                  letterSpacing: '0.18em',
                  fontSize: '0.95rem',
                }}
              >
                战 · 报
              </span>
              <span
                aria-hidden="true"
                style={{
                  color: toCss(palette.uiGold),
                  fontWeight: 800,
                  fontSize: '1rem',
                }}
              >
                ▾
              </span>
            </button>
            {/* Drag-handle hint */}
            <div
              aria-hidden="true"
              style={{
                width: 44,
                height: 4,
                background: 'rgba(247,215,116,0.45)',
                borderRadius: 999,
                margin: '0 auto 6px',
              }}
            />
            <LogList listRef={listRef} entries={entries} />
          </aside>
        </>
      ) : null}

      <style>{`
        @keyframes xdyb-sheet-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

function LogHeader(): JSX.Element {
  return (
    <header
      style={{
        padding: '0.7rem 0.9rem',
        borderBottom: '1px solid rgba(247,215,116,0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <span
        style={{
          color: toCss(palette.uiGold),
          fontWeight: 800,
          letterSpacing: '0.18em',
          fontSize: '0.95rem',
        }}
      >
        战 · 报
      </span>
      <span style={{ fontSize: '0.75rem', color: '#8a8d99' }}>BattleLog</span>
    </header>
  );
}

function LogList({
  listRef,
  entries,
}: {
  listRef: React.MutableRefObject<HTMLDivElement | null>;
  entries: LogEntry[];
}): JSX.Element {
  return (
    <div
      ref={listRef}
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0.6rem 0.7rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        color: toCss(palette.uiPaper),
        fontFamily: 'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: '0.92rem',
        lineHeight: 1.4,
      }}
    >
      {entries.length === 0 ? (
        <div
          style={{
            color: '#8a8d99',
            fontStyle: 'italic',
            fontSize: '0.85rem',
            padding: '0.4rem 0',
          }}
        >
          等待第一回合... 出拳！
        </div>
      ) : null}
      {entries.map((entry) => (
        <LogRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }): JSX.Element {
  // Highlight for ~800ms after appearing
  const ageMs = Date.now() - entry.ts;
  const fresh = ageMs < 800;

  // Color names referenced in the text by replacing player ids with spans
  const verbColor = VERB_COLOR[entry.verb];

  return (
    <div
      style={{
        background: fresh
          ? 'rgba(247,215,116,0.18)'
          : 'rgba(255,255,255,0.04)',
        borderStyle: 'solid',
        borderTopWidth: '1px',
        borderRightWidth: '1px',
        borderBottomWidth: '1px',
        borderLeftWidth: '4px',
        borderTopColor: fresh ? 'rgba(247,215,116,0.55)' : 'rgba(255,255,255,0.08)',
        borderRightColor: fresh ? 'rgba(247,215,116,0.55)' : 'rgba(255,255,255,0.08)',
        borderBottomColor: fresh ? 'rgba(247,215,116,0.55)' : 'rgba(255,255,255,0.08)',
        borderLeftColor: toCss(verbColor),
        padding: '0.45rem 0.6rem',
        borderRadius: 8,
        boxShadow: fresh ? '0 0 14px rgba(247,215,116,0.45)' : 'none',
        animation: fresh ? 'xdyb-fade-in 320ms ease-out' : undefined,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.45rem',
          marginBottom: 4,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            background: toCss(verbColor),
            color: '#1a1208',
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: 6,
            fontSize: '0.85rem',
            letterSpacing: '0.05em',
          }}
        >
          {entry.verb}
        </span>
        <span style={{ fontSize: '0.72rem', color: '#8a8d99', fontFamily: 'ui-monospace, monospace' }}>
          R{entry.round}.{entry.phase}
        </span>
      </div>
      <div
        style={{ color: '#f4ecd8' }}
        // Apply per-actor coloring if actors provided. Cheaper than parsing
        // the string: callers pre-format. We just ensure the text reads.
        // RPS choice tokens (`\u0001ROCK\u0001` / PAPER / SCISSORS) are
        // expanded to inline <RpsGlyph/> SVG icons FIRST so the actor
        // colorizer never sees a control character. Tokens guarantee the
        // R{N}.rps row renders identically in headless Chromium and on
        // Android Chrome subsets without a color-emoji font (FINAL_GOAL
        // / ARCHITECTURE.md §H2: "no emoji in the chrome layer").
      >
        {renderLogText(entry.text, entry.actors ?? [])}
      </div>
    </div>
  );
}

/** Render a log entry's text with both inline RPS-glyph SVGs (in place
 *  of `\u0001ROCK\u0001` etc. tokens) and per-actor color spans. The
 *  pipeline is: 1) split on the U+0001 sentinel into alternating
 *  text/token segments, 2) for each text segment apply the existing
 *  actor colorizer, 3) for each token segment emit an <RpsGlyph/>.
 *  The two-stage split is necessary because the actor colorizer uses
 *  String.indexOf substring matching, and a stray control character in
 *  the middle of a substring would mis-anchor the search. */
function renderLogText(text: string, actors: string[]): JSX.Element[] {
  const out: JSX.Element[] = [];
  // Split keeps both the text between sentinels and the token payloads.
  // Even-index segments are plain text; odd-index segments are token
  // payloads (e.g. "ROCK"). A non-token sentinel pair (or an unknown
  // payload) is preserved as plain text so the row never silently drops
  // characters if the token contract drifts.
  const parts = text.split(RPS_TOKEN_SENTINEL);
  let key = 0;
  parts.forEach((segment, idx) => {
    if (idx % 2 === 0) {
      // Plain-text segment — run it through the actor colorizer with a
      // fresh-key offset so React keys stay stable across re-renders.
      for (const node of colorizeActors(segment, actors)) {
        out.push(<span key={`s${key++}`}>{node}</span>);
      }
      return;
    }
    const choice = parseRpsToken(segment);
    if (choice) {
      out.push(
        <span
          key={`g${key++}`}
          style={{
            display: 'inline-block',
            margin: '0 1px',
            verticalAlign: 'middle',
          }}
        >
          <RpsGlyph kind={choice} size={18} color="#1a1208" fill="#fff2d4" />
        </span>,
      );
    } else {
      // Unrecognized token payload — re-attach the sentinels so the raw
      // text round-trips visibly (debugging aid).
      out.push(
        <span key={`u${key++}`}>
          {RPS_TOKEN_SENTINEL}
          {segment}
          {RPS_TOKEN_SENTINEL}
        </span>,
      );
    }
  });
  return out;
}

function colorizeActors(text: string, actors: string[]): JSX.Element[] {
  // Replace bracketed `[name|id]` tokens with colored spans. If no tokens,
  // just return text as-is. Convention: actors are passed as `name|id` so
  // we can recolor consistently across rounds.
  if (actors.length === 0) {
    return [<span key="t">{text}</span>];
  }
  // Quick replace each `name` substring with a colored span.
  const out: JSX.Element[] = [];
  let remaining = text;
  let key = 0;
  const seen = new Set<string>();
  for (const actor of actors) {
    const [name, id] = actor.split('|');
    if (!name || !id) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const idx = remaining.indexOf(name);
    if (idx < 0) continue;
    if (idx > 0) {
      out.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    }
    out.push(
      <span
        key={key++}
        style={{
          color: toCss(playerColor(id)),
          fontWeight: 700,
        }}
      >
        {name}
      </span>,
    );
    remaining = remaining.slice(idx + name.length);
  }
  if (remaining.length > 0) out.push(<span key={key++}>{remaining}</span>);
  return out;
}

/**
 * Returns true on viewports the layout treats as "mobile" (<768px wide).
 * Listens to window resize events so rotating a phone or resizing the
 * desktop window swaps layouts live without reload.
 */
export function useIsMobile(mode: 'auto' | 'desktop' | 'mobile' = 'auto'): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (mode !== 'auto') return mode === 'mobile';
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  useEffect(() => {
    if (mode !== 'auto') {
      setIsMobile(mode === 'mobile');
      return;
    }
    const onResize = (): void => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, [mode]);
  return isMobile;
}
