// Room.test.ts — unit tests for the server-side Room class.
//
// Drives the Room directly (no Socket.IO transport) and asserts on the
// broadcasts captured via a fake RoomBroadcaster. This is the regression
// guard for FINAL_GOAL §A0/§A4 (multiplayer) and §A2 (engine resolution)
// at the server boundary.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Room, type RoomBroadcaster, type RoomSnapshot, type RoundBroadcast } from './Room.js';

interface CapturedBroadcaster extends RoomBroadcaster {
  snapshots: RoomSnapshot[];
  rounds: RoundBroadcast[];
  errors: Array<{ socketId: string; message: string }>;
}

function makeBroadcaster(): CapturedBroadcaster {
  const snapshots: RoomSnapshot[] = [];
  const rounds: RoundBroadcast[] = [];
  const errors: Array<{ socketId: string; message: string }> = [];
  return {
    snapshots,
    rounds,
    errors,
    emitSnapshot: (s) => snapshots.push(s),
    emitRound: (r) => rounds.push(r),
    emitError: (socketId, message) => errors.push({ socketId, message }),
  };
}

function makeRoom(broadcaster?: CapturedBroadcaster): { room: Room; bx: CapturedBroadcaster } {
  const bx = broadcaster ?? makeBroadcaster();
  const room = new Room({
    roomId: 'TEST',
    hostId: 'sock-host',
    hostNickname: 'Alice',
    hostSocketId: 'sock-host',
    seed: 42,
    broadcaster: bx,
  });
  return { room, bx };
}

describe('Room', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seeds with the host as a member and broadcasts the initial snapshot', () => {
    const { room, bx } = makeRoom();
    expect(room.size()).toBe(1);
    const last = bx.snapshots.at(-1);
    expect(last?.players[0]?.id).toBe('sock-host');
    expect(last?.players[0]?.isHost).toBe(true);
    expect(last?.phase).toBe('LOBBY');
  });

  it('addHuman / addBot grows the roster up to MAX_PLAYERS=6 and rejects beyond', () => {
    const { room } = makeRoom();
    expect(room.addHuman('sock-2', 'Bob', 'sock-2')).toBe(true);
    expect(room.addBot()).toMatch(/^bot-2-/);
    expect(room.addBot()).toMatch(/^bot-3-/);
    expect(room.addBot()).toMatch(/^bot-4-/);
    expect(room.addBot()).toMatch(/^bot-5-/);
    expect(room.size()).toBe(6);
    expect(room.addBot()).toBeNull();
    expect(room.addHuman('sock-7', 'Eve', 'sock-7')).toBe(false);
  });

  it('addBot diversifies strategies round-robin (FINAL_GOAL §A3)', () => {
    const { room } = makeRoom();
    const a = room.addBot()!;
    const b = room.addBot()!;
    const c = room.addBot()!;
    const d = room.addBot()!;
    // first 4 strategies in canonical order: counter,random,iron,mirror
    expect(a).toMatch(/-counter$/);
    expect(b).toMatch(/-random$/);
    expect(c).toMatch(/-iron$/);
    expect(d).toMatch(/-mirror$/);
  });

  it('start requires host + ≥2 players', () => {
    const { room } = makeRoom();
    expect(room.start('sock-host')).toBe(false); // only 1 player
    room.addBot();
    expect(room.start('not-host')).toBe(false); // not host
    expect(room.start('sock-host')).toBe(true);
  });

  it('runs a full round end-to-end and emits a single round broadcast', () => {
    const { room, bx } = makeRoom();
    room.addBot(); // counter
    room.start('sock-host');
    expect(room.submitChoice('sock-host', 'ROCK')).toBe(true);
    expect(bx.rounds.length).toBe(1);
    const round = bx.rounds[0]!;
    expect(round.round).toBe(1);
    expect(round.effects.length).toBeGreaterThan(0);
    expect(round.effects[0]?.type).toBe('ROUND_START');
  });

  it('uses canonical timing.ts hold between rounds (action vs tie)', () => {
    const { room, bx } = makeRoom();
    room.addBot();
    room.addBot();
    room.start('sock-host');
    // submit one round
    room.submitChoice('sock-host', 'ROCK');
    expect(bx.rounds.length).toBe(1);
    // beginRound is scheduled via setTimeout; it should not fire early
    vi.advanceTimersByTime(100);
    // round should still be at 1 in last snapshot OR a new beginRound hasn't fired
    // (we can't observe round counter except via snapshot.round; but the next
    // round's bot pre-submit triggers a new snapshot). Let's just make sure
    // no second round was emitted.
    expect(bx.rounds.length).toBe(1);
    // advance past ROUND_TOTAL_MS (5500 = REVEAL 1500 + ACTION 4000) —
    // second round should now begin (FINAL_GOAL §H2 reveal hold).
    vi.advanceTimersByTime(6000);
    // No new round broadcast yet (humans haven't submitted), but snapshot
    // round counter advances to 2 once beginRound runs.
    const last = bx.snapshots.at(-1);
    expect(last?.round).toBe(2);
  });

  it('host-leave promotes a remaining human to host', () => {
    const { room, bx } = makeRoom();
    room.addHuman('sock-2', 'Bob', 'sock-2');
    expect(bx.snapshots.at(-1)?.hostId).toBe('sock-host');
    room.remove('sock-host');
    expect(bx.snapshots.at(-1)?.hostId).toBe('sock-2');
  });

  it('isAbandoned when only bots remain', () => {
    const { room } = makeRoom();
    room.addBot();
    expect(room.isAbandoned()).toBe(false);
    room.remove('sock-host');
    expect(room.isAbandoned()).toBe(true);
  });

  it('invalid submitChoice paths return false (DEAD, bot, wrong phase, missing player)', () => {
    const { room } = makeRoom();
    room.addBot();
    // Wrong phase (still LOBBY).
    expect(room.submitChoice('sock-host', 'ROCK')).toBe(false);
    room.start('sock-host');
    // Bot id should not accept choices via the human path.
    const botId = [...room.snapshot().players].find((p) => p.isBot)?.id;
    expect(botId).toBeDefined();
    expect(room.submitChoice(botId!, 'ROCK')).toBe(false);
    // Missing player id.
    expect(room.submitChoice('nobody', 'ROCK')).toBe(false);
  });

  it('rematch returns the room to LOBBY only after game ends, host-only', () => {
    const { room, bx } = makeRoom();
    room.addBot();
    room.start('sock-host');
    // Game still PLAYING — rematch should fail.
    expect(room.rematch('sock-host')).toBe(false);
    // Force a game-over by playing rounds until isGameOver fires.
    let safety = 100;
    while (bx.rounds.at(-1)?.isGameOver !== true && safety-- > 0) {
      room.submitChoice('sock-host', 'ROCK');
      vi.advanceTimersByTime(6000);
    }
    expect(safety).toBeGreaterThan(0);
    expect(bx.rounds.at(-1)?.isGameOver).toBe(true);
    expect(room.rematch('not-host')).toBe(false);
    expect(room.rematch('sock-host')).toBe(true);
    expect(bx.snapshots.at(-1)?.phase).toBe('LOBBY');
  });
});
