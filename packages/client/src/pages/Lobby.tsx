// Lobby page — pre-game room view.
//
// Shown after createRoom / joinRoom resolves. Displays the 4-letter code
// (large + copyable), the live player list (host marked), an "addBot"
// button and (host-only) the "开战" start button. Once the host clicks
// 开战, the server transitions to PLAYING and the App route switches to
// MultiGame.

import { useMemo } from 'react';
import { palette, toCss, playerColor } from '../palette.js';
import { addBot, leaveRoom, selfSocketId, startGame } from '../socket.js';
import { useGameStore } from '../store/gameStore.js';

export function LobbyPage(): JSX.Element {
  const code = useGameStore((s) => s.code);
  const snapshot = useGameStore((s) => s.snapshot);
  const error = useGameStore((s) => s.error);

  const meId = selfSocketId();
  const me = useMemo(
    () => snapshot?.players.find((p) => p.id === meId) ?? null,
    [snapshot, meId],
  );
  const isHost = me?.isHost ?? false;
  const playerCount = snapshot?.players.length ?? 0;
  const canStart = isHost && playerCount >= 2;

  const onCopyCode = (): void => {
    if (!code) return;
    try {
      void navigator.clipboard.writeText(code);
    } catch {
      /* clipboard not available */
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        minHeight: '100vh',
        background:
          'radial-gradient(ellipse at center, #1a2030 0%, #0b0d12 70%)',
        fontFamily: 'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
        color: '#f4ecd8',
        padding: '24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <header
        style={{
          width: '100%',
          maxWidth: 560,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2
          style={{
            margin: 0,
            color: toCss(palette.uiGold),
            letterSpacing: '0.18em',
            fontSize: '1.4rem',
            fontWeight: 800,
          }}
        >
          房间大厅
        </h2>
        <button
          type="button"
          onClick={leaveRoom}
          style={{
            padding: '0.4rem 0.9rem',
            borderRadius: 8,
            background: 'transparent',
            border: '1.5px solid #cfb978',
            color: '#cfb978',
            cursor: 'pointer',
            fontSize: '0.85rem',
            letterSpacing: '0.1em',
          }}
        >
          ← 离开
        </button>
      </header>

      <div
        style={{
          width: 'min(440px, 92vw)',
          background: 'rgba(11,13,18,0.85)',
          border: `2px solid ${toCss(palette.uiGold)}`,
          borderRadius: 16,
          padding: '22px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ color: '#cfb978', fontSize: '0.78rem', letterSpacing: '0.18em' }}>
          房间码（分享给朋友）
        </div>
        <div
          onClick={onCopyCode}
          style={{
            fontSize: '3.6rem',
            fontFamily: 'ui-monospace, monospace',
            fontWeight: 900,
            letterSpacing: '0.32em',
            color: toCss(palette.uiGold),
            textShadow: '0 4px 0 #6a4012',
            cursor: 'pointer',
            userSelect: 'all',
            padding: '4px 14px',
          }}
          title="点击复制"
        >
          {code ?? '----'}
        </div>
        <div style={{ color: '#8a7a52', fontSize: '0.75rem' }}>点击数字可复制</div>
      </div>

      <div
        style={{
          width: 'min(440px, 92vw)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            color: '#cfb978',
            fontSize: '0.78rem',
            letterSpacing: '0.18em',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>玩家列表</span>
          <span>{playerCount}/6</span>
        </div>
        <div
          style={{
            background: 'rgba(11,13,18,0.7)',
            border: '2px solid rgba(247,215,116,0.35)',
            borderRadius: 12,
            padding: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            minHeight: 120,
          }}
        >
          {snapshot?.players.length ? (
            snapshot.players.map((p) => (
              <div
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background:
                    p.id === meId ? 'rgba(247,215,116,0.12)' : 'rgba(255,255,255,0.03)',
                  border:
                    p.id === meId
                      ? '1px solid rgba(247,215,116,0.55)'
                      : '1px solid transparent',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: toCss(playerColor(p.id)),
                  }}
                />
                <span style={{ fontWeight: 700 }}>{p.nickname}</span>
                {p.isBot ? (
                  <span style={{ fontSize: '0.7rem', color: '#8a8a8a' }}>BOT</span>
                ) : null}
                {p.isHost ? (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: toCss(palette.uiGold),
                      fontWeight: 800,
                      letterSpacing: '0.1em',
                    }}
                  >
                    ★ HOST
                  </span>
                ) : null}
                {p.id === meId ? (
                  <span style={{ fontSize: '0.7rem', color: '#cfb978' }}>（你）</span>
                ) : null}
              </div>
            ))
          ) : (
            <div style={{ color: '#666', textAlign: 'center', padding: 18 }}>
              等待玩家加入…
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          width: 'min(440px, 92vw)',
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={addBot}
          disabled={!isHost || playerCount >= 6}
          style={{
            flex: 1,
            padding: '0.7rem 1rem',
            borderRadius: 10,
            background: 'rgba(247,215,116,0.18)',
            border: '2px solid rgba(247,215,116,0.55)',
            color: '#f4ecd8',
            fontWeight: 700,
            cursor: !isHost || playerCount >= 6 ? 'not-allowed' : 'pointer',
            opacity: !isHost || playerCount >= 6 ? 0.5 : 1,
            letterSpacing: '0.08em',
          }}
        >
          + 加机器人
        </button>
        <button
          type="button"
          onClick={startGame}
          disabled={!canStart}
          style={{
            flex: 1.5,
            padding: '0.7rem 1rem',
            borderRadius: 10,
            background: canStart ? toCss(palette.uiGold) : '#7a6a3c',
            border: '3px solid #6a4012',
            color: '#1a1208',
            fontWeight: 800,
            fontSize: '1rem',
            letterSpacing: '0.14em',
            cursor: canStart ? 'pointer' : 'not-allowed',
            boxShadow: canStart ? '0 4px 0 rgba(0,0,0,0.6)' : 'none',
            opacity: canStart ? 1 : 0.65,
          }}
        >
          开战
        </button>
      </div>

      {!isHost ? (
        <div style={{ color: '#8a7a52', fontSize: '0.85rem' }}>
          等待房主 (★) 开战…
        </div>
      ) : null}
      {error ? (
        <div style={{ color: '#ff7676', fontSize: '0.85rem' }}>{error}</div>
      ) : null}
    </div>
  );
}
