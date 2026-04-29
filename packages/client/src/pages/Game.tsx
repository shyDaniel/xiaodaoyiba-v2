// Game page — the headline product surface. Mounts the PixiJS GameStage
// (background + characters + houses + parallax foreground) and wraps it
// with React chrome (header, BattleLog right rail, HandPicker bottom bar,
// mute toggle). Drives a LOCAL game loop using the shared engine so the
// page is a real product end-to-end on first load — no Socket.IO required
// to see something working. The Socket.IO swap-in lands when the server
// gains a Room class; until then this is the demonstrable Game surface.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveRound,
  type Effect,
  type PlayerState,
  type RpsChoice,
} from '@xdyb/shared';
import {
  GameStage,
  type StageController,
  type StagePlayer,
} from '../canvas/GameStage.js';
import { HandPicker } from '../components/HandPicker.js';
import { BattleLog, type LogEntry, type LogVerb } from '../components/BattleLog.js';
import { palette, toCss, playerColor } from '../palette.js';
import {
  isMuted as audioIsMuted,
  setMuted as audioSetMuted,
  setVariant as setBgmVariant,
  startBgm,
  stopBgm,
  play as playSfx,
  unlockAudio,
} from '../audio/index.js';

interface BotProfile {
  id: string;
  nickname: string;
  pick: () => RpsChoice;
}

const SHAPES: RpsChoice[] = ['ROCK', 'PAPER', 'SCISSORS'];

function pickRandom(): RpsChoice {
  const i = Math.floor(Math.random() * 3);
  return SHAPES[i] ?? 'ROCK';
}

function makeBots(): BotProfile[] {
  return [
    { id: 'bot-counter', nickname: '小明', pick: () => SHAPES[Math.floor(Math.random() * 3)] ?? 'ROCK' },
    { id: 'bot-iron', nickname: '小刚', pick: () => 'ROCK' },
    { id: 'bot-mirror', nickname: '小芳', pick: pickRandom },
  ];
}

const SELF_ID = 'me';
const SELF_NICK = '你';

interface PhaseInfo {
  label: string;
  hint: string;
}

const PHASE_INFOS: Record<string, PhaseInfo> = {
  IDLE: { label: '出拳', hint: '点击下方按钮选择石头/剪刀/布' },
  WAIT: { label: '等待', hint: '机器人正在出拳…' },
  RESOLVE: { label: '判定', hint: '比较出拳结果' },
  ACTION: { label: '动作', hint: '冲到对方家里！' },
  TIE: { label: '平局', hint: '再来一次！' },
  OVER: { label: '终局', hint: '游戏结束' },
};

export function GamePage(): JSX.Element {
  const [round, setRound] = useState(1);
  const [phase, setPhase] = useState<keyof typeof PHASE_INFOS>('IDLE');
  const [pick, setPick] = useState<RpsChoice | null>(null);
  const [muted, setMuted] = useState<boolean>(() => audioIsMuted());
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [playerStates, setPlayerStates] = useState<PlayerState[]>(() => {
    const bots = makeBots();
    return [
      { id: SELF_ID, nickname: SELF_NICK, stage: 'ALIVE_CLOTHED', isBot: false },
      ...bots.map((b) => ({
        id: b.id,
        nickname: b.nickname,
        stage: 'ALIVE_CLOTHED' as const,
        isBot: true,
      })),
    ];
  });
  const [winnerId, setWinnerId] = useState<string | null>(null);

  const botsRef = useRef<BotProfile[]>(makeBots());
  // Imperative handle into the canvas EffectPlayer. GameStage assigns this
  // once Pixi finishes initializing; submitChoice() awaits a non-null value
  // before dispatching the round timeline. This is the wiring the iter-7
  // worker started but did not finish — without it the canvas was deaf to
  // engine events and characters never RUSHed.
  const stageRef = useRef<StageController | null>(null);

  // Persist mute through the audio module (which also writes localStorage
  // and notifies the BGM driver to halt/resume).
  useEffect(() => {
    audioSetMuted(muted);
  }, [muted]);

  // BGM lifecycle. Start on mount in the lobby variant; switch variants
  // when phase changes; stop on unmount. The very first start() is a
  // no-op until the user clicks something (autoplay policy) — the
  // HandPicker.onClick → unlockAudio() pairing handles that gesture.
  useEffect(() => {
    startBgm('lobby');
    return () => stopBgm();
  }, []);

  // Cross-fade BGM variant on phase change. ACTION/RESOLVE/TIE all map to
  // the battle loop (slightly tense); IDLE/WAIT map to lobby (calm);
  // OVER maps to victory. The cross-fade itself is bounded by
  // CROSSFADE_DURATION_MS (400ms) so the FINAL_GOAL §D "phase change
  // cross-fades within 500ms" guarantee holds.
  useEffect(() => {
    if (phase === 'OVER') {
      setBgmVariant('victory');
    } else if (phase === 'ACTION' || phase === 'RESOLVE' || phase === 'TIE') {
      setBgmVariant('battle');
    } else {
      setBgmVariant('lobby');
    }
  }, [phase]);

  // Round-start ding on every new round (debounced by round-state
  // change so it fires once per round). Skipped on round 1 because the
  // user hasn't yet clicked anything to unlock the AudioContext.
  useEffect(() => {
    if (round <= 1) return;
    playSfx('roundStart');
  }, [round]);

  // Stage players (visual snapshot)
  const stagePlayers: StagePlayer[] = useMemo(
    () =>
      playerStates.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        stage: p.stage,
        isSelf: p.id === SELF_ID,
      })),
    [playerStates],
  );

  const livePlayerIds = useMemo(
    () => playerStates.filter((p) => p.stage !== 'DEAD').map((p) => p.id),
    [playerStates],
  );
  const isOver = livePlayerIds.length <= 1 || winnerId != null;

  const submitChoice = useCallback(
    async (choice: RpsChoice) => {
      if (phase !== 'IDLE' || isOver) return;
      setPick(choice);
      setPhase('WAIT');

      // Brief pause for "thinking" + lets the user see their pick highlight
      await delay(700);

      // Bots pick
      const choices: Record<string, RpsChoice> = { [SELF_ID]: choice };
      for (const bot of botsRef.current) {
        const p = playerStates.find((pp) => pp.id === bot.id);
        if (!p || p.stage === 'DEAD') continue;
        choices[bot.id] = bot.pick();
      }

      setPhase('RESOLVE');
      await delay(500);

      // Resolve via shared engine
      const result = resolveRound(playerStates, round, { choices });

      // Phase: TIE or ACTION
      const isTie = result.rps.tie;
      setPhase(isTie ? 'TIE' : 'ACTION');

      // Delegate the entire round timeline to the canvas EffectPlayer.
      // BattleLog rows are appended via the onNarration callback so each
      // row lands in lockstep with the on-stage beat the engine emitted
      // (PULL_PANTS at atMs=900, STRIKE at atMs=1800, tie at atMs=0).
      // No more setTimeout chains in component scope — the v1
      // entanglement v2 was supposed to eliminate.
      const onNarration = (entry: {
        atMs: number;
        text: string;
        verb: '扒' | '砍' | '闪' | '平' | '死';
        actor?: string;
        target?: string;
      }): void => {
        const actorP = entry.actor
          ? playerStates.find((p) => p.id === entry.actor)
          : undefined;
        const targetP = entry.target
          ? playerStates.find((p) => p.id === entry.target)
          : undefined;
        const actors = isTie
          ? choicesToActors(choices, playerStates)
          : [actorP, targetP]
              .filter((p): p is PlayerState => Boolean(p))
              .map((p) => `${p.nickname}|${p.id}`);
        const phaseTag = isTie
          ? 'tie'
          : entry.verb === '砍'
          ? 'chop'
          : 'pull_pants';
        appendLog(
          {
            round,
            phase: phaseTag,
            verb: entry.verb as LogVerb,
            text: entry.text,
            actors,
          },
          setLogEntries,
        );
      };

      const stage = stageRef.current;
      if (stage) {
        await stage.play(result.effects, playerStates, { onNarration });
      } else {
        // Defensive fallback (Pixi not yet initialized) — emit a single
        // log row + sit for the action's nominal duration so phase still
        // advances. In practice GameStage assigns the controller before
        // any user can throw a fist.
        const tie = result.effects.find(
          (e): e is Extract<Effect, { type: 'TIE_NARRATION' }> =>
            e.type === 'TIE_NARRATION',
        );
        const narrations = result.effects.filter(
          (e): e is Extract<Effect, { type: 'NARRATION' }> =>
            e.type === 'NARRATION',
        );
        if (tie) {
          onNarration({ atMs: 0, text: tie.text, verb: '平' });
        }
        for (const nar of narrations) {
          onNarration({
            atMs: nar.atMs,
            text: nar.text,
            verb: nar.verb,
            actor: nar.actor,
            target: nar.target,
          });
        }
        await delay(isTie ? 2000 : 4000);
      }

      // Apply state from engine and reset characters to home for next round
      setPlayerStates(result.players);
      stageRef.current?.reset(result.players.map((p) => p.id));
      if (result.isGameOver) {
        setWinnerId(result.winnerId);
        const winner = result.players.find((p) => p.id === result.winnerId);
        // Victory/defeat jingle: which one depends on whether the human
        // is the winner. Both kick off as the OVER phase pill appears so
        // the audio + the "★ 你赢了！" header are synchronized.
        if (result.winnerId === SELF_ID) {
          playSfx('victory');
        } else {
          playSfx('defeat');
        }
        appendLog({
          round,
          phase: 'over',
          verb: '胜',
          text: winner ? `${winner.nickname}赢得了胜利！` : '游戏结束',
          actors: winner ? [`${winner.nickname}|${winner.id}`] : [],
        }, setLogEntries);
        setPhase('OVER');
      } else {
        setRound((r) => r + 1);
        setPhase('IDLE');
        setPick(null);
      }
    },
    [phase, isOver, playerStates, round],
  );

  const restart = useCallback(() => {
    setRound(1);
    setPhase('IDLE');
    setPick(null);
    setLogEntries([]);
    setWinnerId(null);
    botsRef.current = makeBots();
    setPlayerStates([
      { id: SELF_ID, nickname: SELF_NICK, stage: 'ALIVE_CLOTHED', isBot: false },
      ...makeBots().map((b) => ({
        id: b.id,
        nickname: b.nickname,
        stage: 'ALIVE_CLOTHED' as const,
        isBot: true,
      })),
    ]);
  }, []);

  const phaseInfo = PHASE_INFOS[phase];
  const selfState = playerStates.find((p) => p.id === SELF_ID);
  const isSelfDead = selfState?.stage === 'DEAD';

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        fontFamily: 'ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      {/* CSS keyframes for fade-in (used by BattleLog rows) */}
      <style>{`
        @keyframes xdyb-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes xdyb-pulse-gold {
          0%, 100% { box-shadow: 0 0 0 rgba(247,215,116,0); }
          50% { box-shadow: 0 0 24px rgba(247,215,116,0.7); }
        }
      `}</style>

      {/* Stage host — sized so the BattleLog right rail doesn't overlap. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          right: 'min(30vw, 360px)',
        }}
      >
        <GameStage players={stagePlayers} controllerRef={stageRef} />
      </div>

      {/* Top header — title + round/phase. Confined to the canvas column so
          it doesn't slide under the BattleLog right rail. */}
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 'min(30vw, 360px)',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 5,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(11,13,18,0.85) 0%, rgba(11,13,18,0.0) 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Knife />
          <h1
            style={{
              margin: 0,
              fontSize: 'clamp(1.4rem, 2.6vw, 2.2rem)',
              color: toCss(palette.uiGold),
              letterSpacing: '0.18em',
              textShadow:
                '0 3px 0 #6a4012, 0 0 18px rgba(247,215,116,0.45)',
              fontWeight: 800,
            }}
          >
            小刀一把
          </h1>
          <span
            style={{
              color: '#cfb978',
              fontSize: '0.85rem',
              letterSpacing: '0.18em',
            }}
          >
            来到你家 · 扒你裤衩 · 直接咔嚓
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            pointerEvents: 'auto',
          }}
        >
          <PhasePill round={round} phase={phase} info={phaseInfo} />
          <MuteButton
            muted={muted}
            onToggle={() => {
              // The mute button click is itself a user gesture — use it
              // to unlock the AudioContext so the lobby BGM starts even
              // for users who toggle audio before clicking a hand.
              unlockAudio();
              setMuted((m) => !m);
            }}
          />
        </div>
      </header>

      {/* Player roster strip — top-left under header */}
      <div
        style={{
          position: 'absolute',
          top: 76,
          left: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          zIndex: 5,
        }}
      >
        {playerStates.map((p) => (
          <PlayerChip key={p.id} player={p} />
        ))}
      </div>

      <BattleLog entries={logEntries} />

      {/* Bottom action bar — confined to canvas column. */}
      <footer
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 'min(30vw, 360px)',
          padding: '14px 16px 18px',
          background:
            'linear-gradient(0deg, rgba(11,13,18,0.92) 0%, rgba(11,13,18,0.0) 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 8,
          zIndex: 5,
        }}
      >
        <div
          style={{
            color: toCss(palette.uiGold),
            fontWeight: 700,
            fontSize: '1rem',
            letterSpacing: '0.08em',
            textShadow: '0 2px 0 #6a4012',
          }}
        >
          {isOver
            ? winnerId === SELF_ID
              ? '★ 你赢了！'
              : winnerId
              ? '× 你输了…'
              : '游戏结束'
            : isSelfDead
            ? '你已被淘汰，旁观剩余战斗'
            : phaseInfo?.hint ?? ''}
        </div>
        {isOver ? (
          <button
            type="button"
            onClick={restart}
            style={{
              padding: '0.7rem 1.6rem',
              borderRadius: 12,
              background: toCss(palette.uiGold),
              border: '3px solid #6a4012',
              color: '#1a1208',
              fontWeight: 800,
              fontSize: '1.05rem',
              letterSpacing: '0.12em',
              cursor: 'pointer',
              boxShadow: '0 4px 0 rgba(0,0,0,0.6)',
            }}
          >
            再来一局
          </button>
        ) : (
          <HandPicker
            enabled={phase === 'IDLE' && !isSelfDead}
            value={pick}
            onPick={(c) => void submitChoice(c)}
          />
        )}
      </footer>
    </div>
  );
}

// ---- helpers ----

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function appendLog(
  entry: Omit<LogEntry, 'id' | 'ts'>,
  setLogEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>,
): void {
  setLogEntries((prev) => [
    ...prev.slice(-40),
    { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now() },
  ]);
}

function choicesToActors(
  choices: Record<string, RpsChoice>,
  players: PlayerState[],
): string[] {
  return Object.keys(choices)
    .map((id) => {
      const p = players.find((pp) => pp.id === id);
      return p ? `${p.nickname}|${p.id}` : null;
    })
    .filter((s): s is string => Boolean(s));
}

// ---- subcomponents ----

function Knife(): JSX.Element {
  return (
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
      <polygon points="13,2 19,2 21,22 16,28 11,22" fill="#d0d8e0" stroke="#5a6068" strokeWidth="0.5" />
      <polygon points="14,2 15,2 16,26" fill="#ffffff" opacity="0.6" />
      <rect x="11" y="22" width="10" height="3" fill="#6a4a28" />
      <rect x="10" y="25" width="12" height="5" fill="#4a2810" />
      <rect x="10" y="29" width="12" height="2" fill="#1a0e08" />
    </svg>
  );
}

function PhasePill({
  round,
  phase,
  info,
}: {
  round: number;
  phase: keyof typeof PHASE_INFOS;
  info: PhaseInfo | undefined;
}): JSX.Element {
  return (
    <div
      style={{
        background: 'rgba(11,13,18,0.7)',
        border: '2px solid rgba(247,215,116,0.45)',
        borderRadius: 999,
        padding: '6px 14px 5px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: '#f4ecd8',
        fontSize: '0.9rem',
        fontWeight: 700,
      }}
    >
      <span
        style={{
          color: toCss(palette.uiGold),
          fontFamily: 'ui-monospace, monospace',
          fontWeight: 800,
        }}
      >
        R{round}
      </span>
      <span style={{ opacity: 0.6 }}>·</span>
      <span style={{ letterSpacing: '0.1em' }}>{info?.label ?? phase}</span>
    </div>
  );
}

function MuteButton({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? 'Unmute' : 'Mute'}
      style={{
        width: 38,
        height: 38,
        borderRadius: '50%',
        border: '2px solid rgba(247,215,116,0.45)',
        background: 'rgba(11,13,18,0.7)',
        color: '#f4ecd8',
        cursor: 'pointer',
        fontSize: '1.1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <g
          stroke="#f4ecd8"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
          fill="#f4ecd8"
        >
          <path d="M4 9 h4 l5 -4 v14 l-5 -4 h-4 z" />
        </g>
        {muted ? (
          <g stroke="#ff5454" strokeWidth="2" strokeLinecap="round">
            <line x1="16" y1="8" x2="22" y2="14" />
            <line x1="22" y1="8" x2="16" y2="14" />
          </g>
        ) : (
          <g stroke="#f4ecd8" strokeWidth="1.8" fill="none" strokeLinecap="round">
            <path d="M16 9 q2 3 0 6" />
            <path d="M19 7 q4 5 0 10" />
          </g>
        )}
      </svg>
    </button>
  );
}

function PlayerChip({ player }: { player: PlayerState }): JSX.Element {
  const dead = player.stage === 'DEAD';
  const pantsDown = player.stage === 'ALIVE_PANTS_DOWN';
  const accent = playerColor(player.id);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px 4px 6px',
        borderRadius: 999,
        background: 'rgba(11,13,18,0.78)',
        border: `2px solid ${toCss(accent)}`,
        color: dead ? '#888' : '#f4ecd8',
        fontSize: '0.85rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        boxShadow: '0 4px 8px rgba(0,0,0,0.45)',
        textDecoration: dead ? 'line-through' : 'none',
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: toCss(accent),
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span>{player.nickname}</span>
      {pantsDown ? (
        <span
          style={{
            color: toCss(palette.briefs),
            fontSize: '0.7rem',
            fontWeight: 800,
          }}
        >
          ! 裤衩
        </span>
      ) : null}
      {dead ? (
        <span style={{ fontSize: '0.7rem', color: '#ff5454', fontWeight: 800 }}>×死</span>
      ) : null}
    </div>
  );
}

