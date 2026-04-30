// MultiGame page — the networked headline product surface.
//
// Mounts the same PixiJS GameStage as solo mode but consumes round timelines
// from the server via the Zustand store instead of running the engine in
// component scope. Flow:
//
//   1. The server has emitted RoomSnapshot with phase=PLAYING and the
//      Lobby route navigated us here.
//   2. We subscribe to `pendingRounds` in the store. When a new
//      RoundBroadcast arrives, we await EffectPlayer.play(effects) — the
//      same call solo mode makes — then shiftRound() to drop it from the
//      queue.
//   3. The HandPicker is enabled iff the local player hasn't yet submitted
//      this round and is alive. On click we call socket.submitChoice().
//   4. On round resolve, the server schedules the next beginRound; when we
//      see hasSubmitted flip back to false we re-enable the picker.
//   5. Game over: snapshot.phase === 'ENDED'. Host sees a "再来一局" button
//      that emits room:rematch.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveRps,
  type ActionKind,
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
import { TargetPicker, type TargetCandidate } from '../components/TargetPicker.js';
import { ActionPicker } from '../components/ActionPicker.js';
import {
  BattleLog,
  buildRowKey,
  formatActionRow,
  type LogEntry,
  type LogVerb,
  useIsMobile,
} from '../components/BattleLog.js';
import { rpsToken } from '../components/RpsGlyph.js';
import { palette, toCss, playerColor, setPlayerColorMap } from '../palette.js';
import {
  isMuted as audioIsMuted,
  setMuted as audioSetMuted,
  setVariant as setBgmVariant,
  startBgm,
  stopBgm,
  play as playSfx,
  unlockAudio,
} from '../audio/index.js';
import {
  leaveRoom,
  rematch,
  selfSocketId,
  submitChoice as socketSubmitChoice,
  submitWinnerChoice as socketSubmitWinnerChoice,
} from '../socket.js';
import { useGameStore } from '../store/gameStore.js';

type PhaseLabel = 'IDLE' | 'WAIT' | 'ACTION' | 'TIE' | 'OVER';

/**
 * S-426: module-scope drain guard. Survives React.StrictMode's double
 * effect mount (the per-instance useRef-based guard cleared itself on
 * cleanup, so the second mount started a parallel drain that
 * appended every narration twice). Tied to module identity, not to a
 * component instance — this is the canonical fix for the "two effects
 * racing the same Zustand queue" pattern. Cleared on full unmount via
 * the cleanup; the second StrictMode mount sees `true` and bails.
 */
let multiDrainInFlight = false;

const PHASE_INFOS: Record<PhaseLabel, { label: string; hint: string }> = {
  IDLE: { label: '出拳', hint: '点击下方按钮选择石头/剪刀/布' },
  WAIT: { label: '等待', hint: '等待其他玩家出拳…' },
  ACTION: { label: '动作', hint: '冲到对方家里！' },
  TIE: { label: '平局', hint: '再来一次！' },
  OVER: { label: '终局', hint: '游戏结束' },
};

export function MultiGamePage(): JSX.Element {
  const snapshot = useGameStore((s) => s.snapshot);
  const pendingRounds = useGameStore((s) => s.pendingRounds);
  const winnerChoice = useGameStore((s) => s.winnerChoice);
  const code = useGameStore((s) => s.code);
  const meId = selfSocketId();

  /** §H3 picker phase machine — starts in 'target' on every fresh
   *  prompt; advances to 'action' when winner can self-restore or has
   *  picked a target. */
  const [pickerPhase, setPickerPhase] = useState<'target' | 'action'>('target');
  const [pickedTarget, setPickedTarget] = useState<string | null>(null);

  const [pick, setPick] = useState<RpsChoice | null>(null);
  const [muted, setMuted] = useState<boolean>(() => audioIsMuted());
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [animatingRound, setAnimatingRound] = useState<number | null>(null);

  const stageRef = useRef<StageController | null>(null);
  // Tracks the round the local user last submitted for, so resetting `pick`
  // lines up with the server's snapshot transition rather than firing
  // immediately on click.
  const lastSubmittedRound = useRef<number | null>(null);

  // Mute persistence
  useEffect(() => {
    audioSetMuted(muted);
  }, [muted]);

  // BGM lifecycle: battle on mount, victory/lobby on phase change.
  useEffect(() => {
    startBgm('battle');
    return () => stopBgm();
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.phase === 'ENDED') {
      setBgmVariant('victory');
    } else if (snapshot.phase === 'LOBBY') {
      setBgmVariant('lobby');
    } else {
      setBgmVariant('battle');
    }
  }, [snapshot?.phase]);

  // The local user's snapshot row (for hasSubmitted, stage, isHost).
  const me = useMemo(
    () => snapshot?.players.find((p) => p.id === meId) ?? null,
    [snapshot, meId],
  );
  const isOver = snapshot?.phase === 'ENDED';
  const winnerId = snapshot?.winnerId ?? null;
  const isHost = me?.isHost ?? false;
  const isSelfDead = me?.stage === 'DEAD';

  // Reset the local pick highlight when the server starts a new round.
  useEffect(() => {
    if (!snapshot) return;
    if (lastSubmittedRound.current !== null && snapshot.round !== lastSubmittedRound.current) {
      setPick(null);
      lastSubmittedRound.current = null;
    }
  }, [snapshot?.round]);

  // §H3 reset picker machine whenever a new winner-choice prompt arrives
  // (or when one is cleared after submission).
  useEffect(() => {
    setPickerPhase('target');
    setPickedTarget(null);
  }, [winnerChoice?.round, winnerChoice?.winnerId]);

  // S-430 register the join-order → palette map so every consumer of
  // `playerColor(id)` (lobby chip dot, in-canvas Character pupil + house
  // roof tint, RevealGlyphs ring, BattleLog name link, TargetPicker
  // border) returns the same hue per slot. Re-run whenever the roster
  // changes (lobby joins, mid-game disconnects). Sorting by joinOrder
  // first keeps client + server in lockstep even if the snapshot ever
  // reorders members[].
  useEffect(() => {
    if (!snapshot) return;
    const ordered = [...snapshot.players]
      .sort((a, b) => a.joinOrder - b.joinOrder)
      .map((p) => p.id);
    setPlayerColorMap(ordered);
  }, [snapshot?.players]);

  // (Build of PlayerState[] used to live here as a useCallback. S-426
  // moved that lookup inside the drain effect — reading from
  // `useGameStore.getState()` at drain time — because the callback's
  // identity flipped on every server snapshot, retriggering the drain
  // mid-flight and producing duplicate BattleLog rows.)

  const stagePlayers: StagePlayer[] = useMemo(
    () =>
      snapshot?.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        stage: p.stage,
        isSelf: p.id === meId,
      })) ?? [],
    [snapshot, meId],
  );

  // Drain pending rounds: as new RoundBroadcasts arrive in the store, play
  // them on the canvas in order, awaiting each before consuming the next.
  // S-426: module-scope `multiDrainInFlight` guard makes this StrictMode-
  // safe — the per-instance useRef approach reset itself on cleanup, so
  // the second mount started a parallel drain that double-appended every
  // narration. With the module-scope flag, the second mount sees `true`
  // and bails immediately; only one drain ever owns the queue.
  useEffect(() => {
    if (multiDrainInFlight) return;
    if (pendingRounds.length === 0) return;
    let cancelled = false;
    multiDrainInFlight = true;

    const drain = async (): Promise<void> => {
      try {
        while (!cancelled) {
          const head = useGameStore.getState().pendingRounds[0];
          if (!head) break;

          setAnimatingRound(head.round);
          // Read freshest player roster from the store at drain time —
          // we no longer depend on `playerStatesFromSnapshot` in the
          // effect deps (its identity flips on every server snapshot
          // and used to retrigger the effect mid-drain → 2× rows).
          const snapNow = useGameStore.getState().snapshot;
          const localId = selfSocketId();
          const players: PlayerState[] = snapNow
            ? snapNow.players.map((p) => ({
                id: p.id,
                nickname: p.nickname,
                stage: p.stage,
                isBot: p.isBot,
              }))
            : [];

          const isTie = head.effects.some((e) => e.type === 'TIE_NARRATION');

          const onNarration = (entry: {
            atMs: number;
            text: string;
            verb: '扒' | '砍' | '闪' | '平' | '死' | '穿';
            actor?: string;
            target?: string;
          }): void => {
            const actorP = entry.actor
              ? players.find((p) => p.id === entry.actor)
              : undefined;
            const targetP = entry.target
              ? players.find((p) => p.id === entry.target)
              : undefined;
            const actors = isTie
              ? players.map((p) => `${p.nickname}|${p.id}`)
              : [actorP, targetP]
                  .filter((p): p is PlayerState => Boolean(p))
                  .map((p) => `${p.nickname}|${p.id}`);
            // FINAL_GOAL §H7: structured action row. Tie phases keep
            // their colloquial line as-is; action phases (扒/砍/穿)
            // emit `R{N}.action  X → Y 扒裤衩|咔嚓|穿好裤衩 ✓ ·
            // {colloquial}` so /R\d+\.action.+(扒裤衩|咔嚓|穿好裤衩).+✓/
            // matches against innerText. Same shape as solo Game.tsx.
            const phaseTag = isTie ? 'tie' : 'action';
            const text = isTie
              ? entry.text
              : formatActionRow({
                  round: head.round,
                  verb: entry.verb,
                  actorNickname: actorP?.nickname ?? entry.actor ?? '？',
                  targetNickname: targetP?.nickname ?? entry.target ?? '？',
                  actorId: entry.actor,
                  targetId: entry.target,
                  colloquial: entry.text,
                });
            // S-426: stable rowKey from (round, phase, actor, target,
            // verb). appendLog rejects duplicates so any redundant
            // narration callback (network replay, double Pixi tween
            // tick, double drain) is a no-op rather than a 2nd row.
            const rowKey = buildRowKey({
              round: head.round,
              phase: phaseTag,
              verb: entry.verb as LogVerb,
              actorId: entry.actor,
              targetId: entry.target,
            });
            appendLog(
              {
                round: head.round,
                phase: phaseTag,
                verb: entry.verb as LogVerb,
                text,
                actors,
                rowKey,
              },
              setLogEntries,
            );
          };

          // S-434: emit the R{N}.rps row synchronously, BEFORE delegating
          // to stage.play(). EffectPlayer renders the reveal glyphs +
          // 'reveal' SFX but never invokes onNarration for RPS_REVEAL,
          // so the multi BattleLog historically had no reveal row at all
          // (acceptance probe: zero rowKeys matching /^\d+\|rps\|/). The
          // server already broadcasts the RPS_REVEAL effect inside
          // result.effects (Room.ts:502 — broadcaster.emitRound carries
          // result.effects verbatim); we extract throws[], reconstruct
          // the winning-choice via shared resolveRps(), then append a
          // single dedup-keyed row mirroring solo Game.tsx:343.
          const reveal = head.effects.find(
            (e): e is Extract<Effect, { type: 'RPS_REVEAL' }> =>
              e.type === 'RPS_REVEAL',
          );
          if (reveal) {
            const rpsResult = resolveRps(
              reveal.throws.map(
                (t) => [t.playerId, t.choice] as const,
              ),
            );
            const throwsText = reveal.throws
              .map((t) => rpsToken(t.choice))
              .join('');
            const winningChoice = rpsResult.winningChoice;
            const winnersText =
              rpsResult.tie || !winningChoice
                ? '平'
                : `${rpsToken(winningChoice)}×${rpsResult.winners.length}`;
            const actorIds = reveal.throws.map((t) => {
              const p = players.find((pp) => pp.id === t.playerId);
              return p ? `${p.nickname}|${p.id}` : t.playerId;
            });
            appendLog(
              {
                round: head.round,
                phase: 'rps',
                verb: '掷',
                text: `throws=[${throwsText}] winners=[${winnersText}]`,
                actors: actorIds,
                rowKey: buildRowKey({
                  round: head.round,
                  phase: 'rps',
                  verb: '掷',
                }),
              },
              setLogEntries,
            );
          }

          const stage = stageRef.current;
          if (stage) {
            await stage.play(head.effects, players, { onNarration });
          } else {
            // Pixi not ready yet — emit narration synchronously so the panel
            // still gets the rows, then sit for the canonical duration.
            for (const eff of head.effects) {
              if (eff.type === 'TIE_NARRATION') {
                onNarration({ atMs: 0, text: eff.text, verb: '平' });
              } else if (eff.type === 'NARRATION') {
                onNarration({
                  atMs: eff.atMs,
                  text: eff.text,
                  verb: eff.verb,
                  ...(eff.actor !== undefined ? { actor: eff.actor } : {}),
                  ...(eff.target !== undefined ? { target: eff.target } : {}),
                });
              }
            }
            await new Promise((r) => window.setTimeout(r, isTie ? 2000 : 4000));
          }

          if (cancelled) break;

          // Reset characters to home after action; on game over also
          // append the victory row + jingle.
          const updatedSnap = useGameStore.getState().snapshot;
          const playerIds = updatedSnap?.players.map((p) => p.id) ?? [];
          stageRef.current?.reset(playerIds);

          if (head.isGameOver) {
            const winner = updatedSnap?.players.find((p) => p.id === head.winnerId);
            if (head.winnerId === localId) {
              playSfx('victory');
            } else {
              playSfx('defeat');
            }
            appendLog(
              {
                round: head.round,
                phase: 'over',
                verb: '胜',
                text: winner ? `${winner.nickname}赢得了胜利！` : '游戏结束',
                actors: winner ? [`${winner.nickname}|${winner.id}`] : [],
                rowKey: buildRowKey({
                  round: head.round,
                  phase: 'over',
                  verb: '胜',
                  actorId: head.winnerId ?? undefined,
                }),
              },
              setLogEntries,
            );
          }

          useGameStore.getState().shiftRound();
          setAnimatingRound(null);
        }
      } finally {
        multiDrainInFlight = false;
      }
    };

    void drain();
    return () => {
      cancelled = true;
      // NB: do NOT clear multiDrainInFlight here — the running drain's
      // own `finally` clears it after the awaited stage.play() resolves.
      // Clearing on cleanup is what produced the iter-7 race; leaving
      // it true makes the StrictMode second mount short-circuit cleanly.
    };
    // S-426: deps include ONLY the new-round signal. The drain reads
    // `useGameStore.getState()` for fresh data, so depending on
    // `playerStatesFromSnapshot` (whose identity flips on every
    // server snapshot) caused a teardown+restart mid-drain that
    // re-played stage.play() on the same head — producing the 2×
    // duplicate-row symptom from the brief.
  }, [pendingRounds.length]);

  const onPick = useCallback(
    (choice: RpsChoice) => {
      if (!snapshot || snapshot.phase !== 'PLAYING') return;
      if (!me || me.stage === 'DEAD' || me.hasSubmitted) return;
      if (animatingRound !== null) return;
      setPick(choice);
      lastSubmittedRound.current = snapshot.round;
      socketSubmitChoice(choice);
      playSfx('tap');
    },
    [snapshot, me, animatingRound],
  );

  // §H3 target picker callback. Null = timeout → fall through to engine
  // auto-pick by submitting (null, null). When the target is picked AND
  // the winner can self-restore, advance to the action picker so 穿好裤衩
  // remains an option; otherwise the action defaults from target stage
  // and we can submit immediately.
  const onTargetPick = useCallback(
    (targetId: string | null) => {
      if (!winnerChoice) return;
      if (targetId === null) {
        socketSubmitWinnerChoice(null, null);
        return;
      }
      setPickedTarget(targetId);
      if (winnerChoice.canSelfRestore) {
        setPickerPhase('action');
      } else {
        socketSubmitWinnerChoice(targetId, null);
      }
    },
    [winnerChoice],
  );

  const onActionPick = useCallback(
    (action: ActionKind | null) => {
      if (!winnerChoice) return;
      // PULL_OWN_PANTS_UP is self-targeted — engine ignores `target` for
      // it but we send null to keep payload compact.
      if (action === 'PULL_OWN_PANTS_UP') {
        socketSubmitWinnerChoice(null, action);
      } else {
        socketSubmitWinnerChoice(pickedTarget, action);
      }
    },
    [winnerChoice, pickedTarget],
  );

  // Derived UI phase label. Server's snapshot.phase is coarse (LOBBY /
  // PLAYING / ENDED); we synthesize a finer state for the phase pill.
  const uiPhase: PhaseLabel = useMemo(() => {
    if (!snapshot) return 'IDLE';
    if (snapshot.phase === 'ENDED') return 'OVER';
    if (animatingRound !== null) {
      // Detect tie vs action by looking at the round-in-flight.
      const head = pendingRounds[0];
      if (head && head.effects.some((e) => e.type === 'TIE_NARRATION')) return 'TIE';
      return 'ACTION';
    }
    if (me?.hasSubmitted) return 'WAIT';
    return 'IDLE';
  }, [snapshot, animatingRound, pendingRounds, me?.hasSubmitted]);

  // Hooks must run unconditionally — `useIsMobile` is called before the
  // early-return below so React's hook order is stable across renders
  // when the snapshot first arrives.
  const isMobile = useIsMobile();
  const railOffset = isMobile ? '0px' : 'min(30vw, 360px)';
  // §H1 (S-411) canvas inset — the React chrome (PlayerRail chips
  // strip, HandPicker footer, BattleLog bottom-sheet on mobile) used
  // to overlay the canvas, occluding leftmost / bottom-row characters.
  // Now the canvas DOM is bounded by these inset values so its
  // drawable rect equals its visible rect; layout.ts only adds a small
  // cosmetic gutter on top.
  //   Desktop: PlayerRail chips column ≈140 px wide on the left;
  //            footer (HandPicker + label) ≈180 px on the bottom.
  //            (left inset kept ≤ (1280 - railOffset - 768) so the
  //            canvas inner width stays in the wide-layout codepath.)
  //   Mobile : PlayerRail chips strip ≈60 px on the top (under header);
  //            HandPicker footer + BattleLog toggle ≈200 px on the bottom.
  const canvasTopInset = isMobile ? 112 : 0;
  const canvasLeftInset = isMobile ? 0 : 144;
  const canvasBottomInset = isMobile ? 200 : 184;

  if (!snapshot) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0d12',
          color: '#cfb978',
          fontFamily: 'ui-sans-serif, "PingFang SC", sans-serif',
        }}
      >
        加载房间…
      </div>
    );
  }

  const phaseInfo = PHASE_INFOS[uiPhase];

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

      <div
        style={{
          position: 'absolute',
          top: canvasTopInset,
          left: canvasLeftInset,
          bottom: canvasBottomInset,
          right: railOffset,
        }}
      >
        <GameStage players={stagePlayers} controllerRef={stageRef} />
      </div>

      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: railOffset,
          padding: isMobile ? '10px 12px 8px' : '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          zIndex: 5,
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(11,13,18,0.85) 0%, rgba(11,13,18,0.0) 100%)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 8 : 14,
            minWidth: 0,
          }}
        >
          <Knife />
          <h1
            style={{
              margin: 0,
              fontSize: isMobile ? '1.05rem' : 'clamp(1.4rem, 2.6vw, 2.2rem)',
              color: toCss(palette.uiGold),
              letterSpacing: isMobile ? '0.08em' : '0.18em',
              textShadow:
                '0 3px 0 #6a4012, 0 0 18px rgba(247,215,116,0.45)',
              fontWeight: 800,
              whiteSpace: 'nowrap',
            }}
          >
            小刀一把
          </h1>
          {!isMobile ? (
            <span
              style={{
                color: '#cfb978',
                fontSize: '0.75rem',
                letterSpacing: '0.18em',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              房间 {code}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            pointerEvents: 'auto',
          }}
        >
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
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            <span
              style={{
                color: toCss(palette.uiGold),
                fontFamily: 'ui-monospace, monospace',
                fontWeight: 800,
              }}
            >
              R{snapshot.round || 1}
            </span>
            <span style={{ opacity: 0.6 }}>·</span>
            <span style={{ letterSpacing: '0.1em' }}>{phaseInfo.label}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              setMuted((m) => !m);
            }}
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
            }}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {/* Player roster strip — vertical column on desktop, wrapped
          flex-row on mobile so all N chips render inside the viewport
          (FINAL_GOAL §H1 — no offscreen chips, no horizontal overflow). */}
      <div
        style={
          isMobile
            ? {
                position: 'absolute',
                top: 52,
                left: 0,
                right: 0,
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: 4,
                padding: '0 6px',
                zIndex: 5,
                pointerEvents: 'auto',
              }
            : {
                position: 'absolute',
                top: 76,
                left: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                zIndex: 5,
                maxHeight: 'calc(100vh - 200px)',
                flexWrap: 'wrap',
              }
        }
      >
        {snapshot.players.map((p) => {
          const accent = playerColor(p.id);
          const dead = p.stage === 'DEAD';
          const pantsDown = p.stage === 'ALIVE_PANTS_DOWN';
          return (
            <div
              key={p.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? 4 : 8,
                padding: isMobile ? '3px 8px 3px 4px' : '4px 10px 4px 6px',
                borderRadius: 999,
                background: 'rgba(11,13,18,0.78)',
                border: `2px solid ${toCss(accent)}`,
                color: dead ? '#888' : '#f4ecd8',
                fontSize: isMobile ? '0.7rem' : '0.85rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                boxShadow: '0 4px 8px rgba(0,0,0,0.45)',
                textDecoration: dead ? 'line-through' : 'none',
                maxWidth: isMobile ? '48vw' : 'unset',
              }}
            >
              <span
                style={{
                  width: isMobile ? 12 : 18,
                  height: isMobile ? 12 : 18,
                  borderRadius: '50%',
                  background: toCss(accent),
                  display: 'inline-block',
                  flexShrink: 0,
                }}
              />
              <span>{p.nickname}</span>
              {p.id === meId ? (
                <span style={{ fontSize: '0.7rem', color: '#cfb978' }}>(你)</span>
              ) : null}
              {p.hasSubmitted && snapshot.phase === 'PLAYING' && !dead ? (
                <span style={{ fontSize: '0.7rem', color: '#7ad17a' }}>✓</span>
              ) : null}
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
        })}
      </div>

      {/* §H3 winner-agency pickers — only the local human winner sees
          the overlay; bots / non-winners get nothing. */}
      {winnerChoice && winnerChoice.winnerId === meId ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          {pickerPhase === 'target' ? (
            <TargetPicker
              candidates={winnerChoice.candidates
                .filter((c) => c.stage !== 'DEAD')
                .map(
                  (c): TargetCandidate => ({
                    id: c.id,
                    nickname: c.nickname,
                    stage: c.stage as 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN',
                  }),
                )}
              timeoutMs={winnerChoice.budgetMs}
              onPick={onTargetPick}
            />
          ) : (
            (() => {
              const targetCand = winnerChoice.candidates.find(
                (c) => c.id === pickedTarget,
              );
              const targetStage =
                targetCand && targetCand.stage !== 'DEAD'
                  ? (targetCand.stage as 'ALIVE_CLOTHED' | 'ALIVE_PANTS_DOWN')
                  : undefined;
              const winnerStage =
                winnerChoice.winnerStage === 'DEAD'
                  ? 'ALIVE_CLOTHED'
                  : (winnerChoice.winnerStage as
                      | 'ALIVE_CLOTHED'
                      | 'ALIVE_PANTS_DOWN');
              return (
                <ActionPicker
                  winnerStage={winnerStage}
                  targetStage={targetStage}
                  timeoutMs={winnerChoice.budgetMs}
                  onPick={onActionPick}
                />
              );
            })()
          )}
        </div>
      ) : null}

      <BattleLog entries={logEntries} />

      {/* Bottom action bar — full width on mobile, canvas-column-only on
          desktop. */}
      <footer
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: railOffset,
          padding: isMobile ? '10px 8px 14px' : '14px 16px 18px',
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
            ? winnerId === meId
              ? '★ 你赢了！'
              : winnerId
              ? '× 你输了…'
              : '游戏结束'
            : isSelfDead
            ? '你已被淘汰，旁观剩余战斗'
            : phaseInfo.hint}
        </div>
        {isOver ? (
          <div style={{ display: 'flex', gap: 10 }}>
            {isHost ? (
              <button
                type="button"
                onClick={rematch}
                style={primaryFooterButtonStyle()}
              >
                再来一局
              </button>
            ) : (
              <span style={{ color: '#8a7a52', fontSize: '0.9rem' }}>
                等待房主开启下一局…
              </span>
            )}
            <button
              type="button"
              onClick={leaveRoom}
              style={secondaryFooterButtonStyle()}
            >
              离开
            </button>
          </div>
        ) : (
          <HandPicker
            enabled={uiPhase === 'IDLE' && !isSelfDead}
            value={pick}
            onPick={onPick}
          />
        )}
      </footer>
    </div>
  );
}

// ---- helpers ----

/**
 * S-426: dedup-on-append. If the new entry carries a `rowKey` already
 * present in the most recent N rows, the append is a no-op — this
 * collapses any redundant narration callback (StrictMode-driven
 * effect remount, in-flight drain that overlapped with a teardown,
 * server replay) into the single row the user expects. The window of
 * "most recent N rows" is the trailing 40 we already cap at, so we
 * never grow unboundedly even if the same key recurs many rounds
 * apart (impossible in practice — `round` is part of the key).
 */
function appendLog(
  entry: Omit<LogEntry, 'id' | 'ts'>,
  setLogEntries: React.Dispatch<React.SetStateAction<LogEntry[]>>,
): void {
  setLogEntries((prev) => {
    if (entry.rowKey) {
      // Linear scan over the trailing 40 rows we keep — O(40) is fine.
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i]?.rowKey === entry.rowKey) {
          return prev;
        }
      }
    }
    return [
      ...prev.slice(-40),
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        ts: Date.now(),
      },
    ];
  });
}

function primaryFooterButtonStyle(): React.CSSProperties {
  return {
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
  };
}

function secondaryFooterButtonStyle(): React.CSSProperties {
  return {
    padding: '0.7rem 1.2rem',
    borderRadius: 12,
    background: 'rgba(247,215,116,0.18)',
    border: '2px solid rgba(247,215,116,0.55)',
    color: '#f4ecd8',
    fontWeight: 700,
    fontSize: '1rem',
    letterSpacing: '0.12em',
    cursor: 'pointer',
  };
}

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

// Suppress unused-import warnings — `Effect` is referenced via the
// pendingRound consumer's narrowing path above.
type _UnusedEffect = Effect;
