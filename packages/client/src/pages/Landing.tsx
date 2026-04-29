// Landing page — the entry funnel.
//
// User flow:
//   1. Pick a nickname (defaults to "你" + 2-digit suffix; persisted in
//      localStorage between visits).
//   2. Choose between:
//        a) "新建房间" — server creates a 4-char code, user lands in Lobby
//           as host.
//        b) "加入房间" — user types a friend's 4-char code, lands in Lobby
//           as a guest.
//        c) "单机练习" — bypasses the server entirely, drops directly into
//           a local single-player game with 3 mixed-strategy bots (the
//           pre-S-324 single-player surface, kept as a fallback).
//
// The viral "send code to a friend" loop hangs off this page.

import { useEffect, useState } from 'react';
import { palette, toCss } from '../palette.js';
import { connect, createRoom, joinRoom } from '../socket.js';
import { useGameStore } from '../store/gameStore.js';

const NICK_KEY = 'xdyb.nickname';

function defaultNickname(): string {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(NICK_KEY) : null;
  if (stored && stored.trim().length > 0) return stored;
  const suffix = Math.floor(Math.random() * 90 + 10);
  return `玩家${suffix}`;
}

export function LandingPage({ onSolo }: { onSolo: () => void }): JSX.Element {
  const [nickname, setNickname] = useState<string>(defaultNickname);
  const [code, setCode] = useState<string>('');
  const connected = useGameStore((s) => s.connected);
  const error = useGameStore((s) => s.error);

  // Open the socket eagerly so the "新建/加入" buttons feel instant.
  useEffect(() => {
    connect();
  }, []);

  // Persist nickname so the next visit doesn't reset to a random suffix.
  useEffect(() => {
    if (nickname.trim()) {
      try {
        localStorage.setItem(NICK_KEY, nickname.trim());
      } catch {
        /* ignore quota / private mode */
      }
    }
  }, [nickname]);

  const trimmed = nickname.trim();
  const canCreate = connected && trimmed.length > 0;
  const canJoin = canCreate && code.trim().length === 4;

  const onCreate = (): void => {
    if (!canCreate) return;
    createRoom(trimmed);
  };
  const onJoin = (): void => {
    if (!canJoin) return;
    joinRoom(code.trim().toUpperCase(), trimmed);
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at center, #1a2030 0%, #0b0d12 70%)',
        fontFamily: 'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
        color: '#f4ecd8',
        padding: '24px',
        boxSizing: 'border-box',
      }}
    >
      <h1
        style={{
          margin: 0,
          fontSize: 'clamp(2rem, 5vw, 3.4rem)',
          color: toCss(palette.uiGold),
          letterSpacing: '0.18em',
          textShadow:
            '0 4px 0 #6a4012, 0 0 24px rgba(247,215,116,0.5)',
          fontWeight: 800,
          textAlign: 'center',
        }}
      >
        小刀一把
      </h1>
      <p
        style={{
          marginTop: 8,
          marginBottom: 28,
          color: '#cfb978',
          letterSpacing: '0.18em',
          fontSize: 'clamp(0.9rem, 1.8vw, 1.05rem)',
          textAlign: 'center',
        }}
      >
        来到你家 · 扒你裤衩 · 直接咔嚓
      </p>

      <div
        style={{
          width: 'min(440px, 92vw)',
          background: 'rgba(11,13,18,0.85)',
          border: `2px solid ${toCss(palette.uiGold)}`,
          borderRadius: 16,
          padding: '22px 22px 24px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <Field label="你的昵称">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={16}
            placeholder="例如：小明"
            style={fieldInputStyle()}
          />
        </Field>

        <button
          type="button"
          onClick={onCreate}
          disabled={!canCreate}
          style={primaryButtonStyle(!canCreate)}
        >
          + 新建房间
        </button>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 4,
          }}
        >
          <div style={{ flex: 1, height: 1, background: 'rgba(247,215,116,0.25)' }} />
          <span style={{ color: '#8a7a52', fontSize: '0.8rem' }}>或</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(247,215,116,0.25)' }} />
        </div>

        <Field label="加入好友的房间">
          <input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 4))
            }
            maxLength={4}
            placeholder="4 位房间码（如 PXJ9）"
            style={{ ...fieldInputStyle(), letterSpacing: '0.4em', fontFamily: 'ui-monospace, monospace' }}
          />
        </Field>
        <button
          type="button"
          onClick={onJoin}
          disabled={!canJoin}
          style={secondaryButtonStyle(!canJoin)}
        >
          → 加入
        </button>

        <div
          style={{
            marginTop: 8,
            fontSize: '0.78rem',
            color: connected ? '#7ad17a' : '#cfa05a',
            textAlign: 'center',
          }}
        >
          {connected ? '已连接服务器' : '连接服务器中…'}
          {error ? <span style={{ color: '#ff7676', display: 'block', marginTop: 4 }}>{error}</span> : null}
        </div>
      </div>

      <button
        type="button"
        onClick={onSolo}
        style={{
          marginTop: 18,
          padding: '0.55rem 1.2rem',
          borderRadius: 10,
          background: 'transparent',
          border: '1.5px solid rgba(247,215,116,0.45)',
          color: '#cfb978',
          fontWeight: 700,
          letterSpacing: '0.12em',
          cursor: 'pointer',
          fontSize: '0.85rem',
        }}
      >
        单机练习（不联网）
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: '0.78rem', color: '#cfb978', letterSpacing: '0.1em' }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function fieldInputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '0.62rem 0.8rem',
    borderRadius: 10,
    border: '2px solid rgba(247,215,116,0.4)',
    background: 'rgba(20,24,32,0.9)',
    color: '#f4ecd8',
    fontSize: '1rem',
    fontWeight: 600,
    outline: 'none',
    boxSizing: 'border-box',
  };
}

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.75rem 1.4rem',
    borderRadius: 12,
    background: disabled ? '#7a6a3c' : toCss(palette.uiGold),
    border: '3px solid #6a4012',
    color: '#1a1208',
    fontWeight: 800,
    fontSize: '1.05rem',
    letterSpacing: '0.12em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    boxShadow: '0 4px 0 rgba(0,0,0,0.6)',
    opacity: disabled ? 0.65 : 1,
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '0.6rem 1.2rem',
    borderRadius: 10,
    background: 'rgba(247,215,116,0.18)',
    border: '2px solid rgba(247,215,116,0.55)',
    color: '#f4ecd8',
    fontWeight: 700,
    fontSize: '0.95rem',
    letterSpacing: '0.1em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
}
