// Zustand game store — the single React-side source of truth for room state.
//
// FINAL_GOAL §A:
//   "Zustand for client state (room snapshot, player list, mute toggle).
//    Animation/sprite frame state lives in PixiJS, NOT in Zustand."
//
// This store mirrors the server's RoomSnapshot verbatim plus a small queue of
// RoundBroadcast payloads (one per resolved round) that Game.tsx drains by
// awaiting EffectPlayer.play(). Once a round is consumed, it's removed from
// the queue. Connection-level state (connected, error) sits alongside.
//
// Animation state — current phase ms, sprite frames, camera shake — does NOT
// belong here; it lives in Pixi (canvas/EffectPlayer.ts + Camera/ScreenShake).

import { create } from 'zustand';
import type { Effect, PlayerState } from '@xdyb/shared';

/** §H3 server-emitted winner-choice prompt. The client renders pickers
 *  while the prompt is set; clearing it (via clearWinnerChoice) signals
 *  the picker UI has either resolved or timed out locally. */
export interface WinnerChoicePrompt {
  round: number;
  winnerId: string;
  winnerStage: PlayerState['stage'];
  candidates: ReadonlyArray<{
    id: string;
    nickname: string;
    stage: PlayerState['stage'];
  }>;
  canSelfRestore: boolean;
  budgetMs: number;
}

export interface RoomSnapshot {
  roomId: string;
  hostId: string;
  phase: 'LOBBY' | 'PLAYING' | 'ENDED';
  round: number;
  players: ReadonlyArray<{
    id: string;
    nickname: string;
    isBot: boolean;
    stage: PlayerState['stage'];
    isHost: boolean;
    hasSubmitted: boolean;
  }>;
  lastNarration: string;
  winnerId: string | null;
}

export interface RoundBroadcast {
  round: number;
  effects: ReadonlyArray<Effect>;
  narration: string;
  isGameOver: boolean;
  winnerId: string | null;
}

interface GameStoreState {
  connected: boolean;
  error: string | null;
  /** 4-letter room code; null when not in a room. */
  code: string | null;
  /** Latest snapshot from the server; null when not in a room. */
  snapshot: RoomSnapshot | null;
  /** Pending unconsumed round broadcasts. Game.tsx pops oldest-first. */
  pendingRounds: RoundBroadcast[];
  /** §H3 active server-issued winner-choice prompt; null when no
   *  picker should be displayed. */
  winnerChoice: WinnerChoicePrompt | null;

  setConnected(v: boolean): void;
  setError(e: string | null): void;
  setRoom(code: string, snapshot: RoomSnapshot): void;
  applySnapshot(snapshot: RoomSnapshot): void;
  clearRoom(): void;
  pushRound(round: RoundBroadcast): void;
  /** Drop the oldest pending round (Game.tsx calls this after EffectPlayer finishes). */
  shiftRound(): void;
  setWinnerChoice(prompt: WinnerChoicePrompt | null): void;
  clearWinnerChoice(): void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  connected: false,
  error: null,
  code: null,
  snapshot: null,
  pendingRounds: [],
  winnerChoice: null,

  setConnected: (v) => set({ connected: v }),
  setError: (e) => set({ error: e }),
  setRoom: (code, snapshot) => set({ code, snapshot, pendingRounds: [], winnerChoice: null }),
  applySnapshot: (snapshot) =>
    set((s) => (s.code ? { snapshot } : { code: snapshot.roomId, snapshot })),
  clearRoom: () =>
    set({ code: null, snapshot: null, pendingRounds: [], winnerChoice: null, error: null }),
  pushRound: (round) =>
    set((s) => ({ pendingRounds: [...s.pendingRounds, round] })),
  shiftRound: () =>
    set((s) => ({ pendingRounds: s.pendingRounds.slice(1) })),
  setWinnerChoice: (prompt) => set({ winnerChoice: prompt }),
  clearWinnerChoice: () => set({ winnerChoice: null }),
}));

/** Convenience selector: the snapshot's player whose id matches the given socket id (the local user). */
export function selectSelf(
  s: GameStoreState,
  selfId: string | null,
): RoomSnapshot['players'][number] | undefined {
  if (!s.snapshot || !selfId) return undefined;
  return s.snapshot.players.find((p) => p.id === selfId);
}
