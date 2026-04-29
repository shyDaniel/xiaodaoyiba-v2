// BattleLog — fixed right rail showing per-round narration. Each entry
// has timestamp prefix `R{N}.{phase}`, color-coded action badges, fade-in
// + 800ms yellow glow on new entries. Scrollable history.

import { useEffect, useRef } from 'react';
import { toCss, palette, playerColor } from '../palette.js';

export type LogVerb = '扒' | '砍' | '闪' | '平' | '死' | '胜';

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
};

export interface BattleLogProps {
  entries: LogEntry[];
}

export function BattleLog({ entries }: BattleLogProps): JSX.Element {
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
        <span style={{ fontSize: '0.75rem', color: '#8a8d99' }}>
          BattleLog
        </span>
      </header>
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
    </aside>
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
      >
        {colorizeActors(entry.text, entry.actors ?? [])}
      </div>
    </div>
  );
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
