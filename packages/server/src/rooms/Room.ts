// Room — server-side game state for one match.
//
// Holds the player roster, collects RPS choices each round, runs the engine
// when all alive players have submitted, and broadcasts the resulting
// Effect[] choreography to every socket. The client's EffectPlayer schedules
// canvas calls at each Effect.atMs offset; the server is purely a coordinator.
//
// Bots are first-class room members with their own seeded RNG (FINAL_GOAL §A4)
// and diversified strategies (§A3) — exactly what `pnpm sim` uses, just over
// a Socket.IO transport instead of stdout.

import {
  ROUND_TOTAL_MS,
  TIE_NARRATION_HOLD_MS,
  type BotKind,
  type BotStrategy,
  type Effect,
  type PlayerState,
  type RoundHistoryEntry,
  type RoundInputs,
  type RpsChoice,
  type Rng,
  getBotStrategy,
  pickStrategyForIndex,
  resolveRound,
  seededRng,
} from '@xdyb/shared';

export interface RoomMember {
  /** Stable id; matches socket.id for humans, derived id for bots. */
  id: string;
  nickname: string;
  isBot: boolean;
  /** undefined for bots; socket.id for humans (1:1 with id today). */
  socketId: string | undefined;
  /** undefined for humans; populated for bots. */
  bot?: {
    kind: BotKind;
    strategy: BotStrategy;
    rng: Rng;
  };
}

/** Public-facing snapshot of a room (broadcast to clients on changes). */
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
  /** Last-round narration (for late joiners / reconnects); empty during LOBBY. */
  lastNarration: string;
  winnerId: string | null;
}

/** Effect-list payload broadcast each round. Mirrors the sim CLI's per-round emission. */
export interface RoundBroadcast {
  round: number;
  effects: ReadonlyArray<Effect>;
  narration: string;
  isGameOver: boolean;
  winnerId: string | null;
}

export interface RoomBroadcaster {
  emitSnapshot(snapshot: RoomSnapshot): void;
  emitRound(payload: RoundBroadcast): void;
  emitError(socketId: string, message: string): void;
}

export interface RoomOptions {
  roomId: string;
  hostId: string;
  hostNickname: string;
  hostSocketId: string;
  /** Optional fixed seed (debugging / reproducible E2E). */
  seed?: number;
  broadcaster: RoomBroadcaster;
}

const MAX_PLAYERS = 6;

export class Room {
  readonly roomId: string;
  readonly seed: number;
  private hostId: string;
  private members: RoomMember[] = [];
  private players: PlayerState[] = [];
  private history: RoundHistoryEntry[] = [];
  private choices: Record<string, RpsChoice> = {};
  private phase: RoomSnapshot['phase'] = 'LOBBY';
  private round = 0;
  private lastNarration = '';
  private winnerId: string | null = null;
  private readonly broadcaster: RoomBroadcaster;

  constructor(opts: RoomOptions) {
    this.roomId = opts.roomId;
    this.hostId = opts.hostId;
    this.seed = opts.seed ?? ((Date.now() & 0x7fffffff) >>> 0);
    this.broadcaster = opts.broadcaster;
    this.addHuman(opts.hostId, opts.hostNickname, opts.hostSocketId);
  }

  /** Total members (humans + bots). */
  size(): number {
    return this.members.length;
  }

  isEmpty(): boolean {
    return this.members.filter((m) => !m.isBot).length === 0;
  }

  hasMember(id: string): boolean {
    return this.members.some((m) => m.id === id);
  }

  /** True if no human is left in the room (used by the server to GC empty rooms). */
  isAbandoned(): boolean {
    return this.members.every((m) => m.isBot);
  }

  /** Add a human player. Returns false if the room is full or game in progress. */
  addHuman(id: string, nickname: string, socketId: string): boolean {
    if (this.phase !== 'LOBBY') return false;
    if (this.members.length >= MAX_PLAYERS) return false;
    if (this.hasMember(id)) return false;
    this.members.push({ id, nickname, isBot: false, socketId });
    this.players.push({ id, nickname, stage: 'ALIVE_CLOTHED', isBot: false });
    this.broadcastSnapshot();
    return true;
  }

  /** Add a bot with a diversified strategy. Returns the bot's id, or null if full. */
  addBot(): string | null {
    if (this.phase !== 'LOBBY') return null;
    if (this.members.length >= MAX_PLAYERS) return null;
    const botIndex = this.members.filter((m) => m.isBot).length;
    const strategy = pickStrategyForIndex(botIndex);
    const id = `bot-${this.members.length}-${strategy.kind}`;
    const member: RoomMember = {
      id,
      nickname: strategy.kind,
      isBot: true,
      socketId: undefined,
      bot: {
        kind: strategy.kind,
        strategy,
        rng: seededRng(this.seed, this.roomId, id),
      },
    };
    this.members.push(member);
    this.players.push({ id, nickname: member.nickname, stage: 'ALIVE_CLOTHED', isBot: true });
    this.broadcastSnapshot();
    return id;
  }

  /** Force a specific bot kind (admin / test path). */
  addBotOfKind(kind: BotKind): string | null {
    if (this.phase !== 'LOBBY') return null;
    if (this.members.length >= MAX_PLAYERS) return null;
    const strategy = getBotStrategy(kind);
    const id = `bot-${this.members.length}-${kind}`;
    const member: RoomMember = {
      id,
      nickname: kind,
      isBot: true,
      socketId: undefined,
      bot: { kind, strategy, rng: seededRng(this.seed, this.roomId, id) },
    };
    this.members.push(member);
    this.players.push({ id, nickname: member.nickname, stage: 'ALIVE_CLOTHED', isBot: true });
    this.broadcastSnapshot();
    return id;
  }

  /** Remove a member (disconnect or kick). Returns true if the member was found. */
  remove(id: string): boolean {
    const idx = this.members.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.members.splice(idx, 1);
    this.players = this.players.filter((p) => p.id !== id);
    delete this.choices[id];
    if (this.hostId === id && this.members.length > 0) {
      // Promote the first remaining human as new host; if no humans left,
      // pick the first member.
      const newHost = this.members.find((m) => !m.isBot) ?? this.members[0]!;
      this.hostId = newHost.id;
    }
    this.broadcastSnapshot();
    return true;
  }

  /** Host triggers game start. Returns false if not host or invalid state. */
  start(actorId: string): boolean {
    if (actorId !== this.hostId) return false;
    if (this.phase !== 'LOBBY') return false;
    if (this.members.length < 2) return false;
    this.phase = 'PLAYING';
    this.round = 0;
    this.history = [];
    this.choices = {};
    this.players = this.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      stage: 'ALIVE_CLOTHED',
      isBot: m.isBot,
    }));
    this.lastNarration = '';
    this.winnerId = null;
    this.broadcastSnapshot();
    this.beginRound();
    return true;
  }

  /** A human submits an RPS choice. Bots auto-submit via beginRound. */
  submitChoice(actorId: string, choice: RpsChoice): boolean {
    if (this.phase !== 'PLAYING') return false;
    const member = this.members.find((m) => m.id === actorId);
    if (!member || member.isBot) return false;
    const player = this.players.find((p) => p.id === actorId);
    if (!player || player.stage === 'DEAD') return false;
    this.choices[actorId] = choice;
    this.broadcastSnapshot();
    if (this.allAliveSubmitted()) {
      this.resolveCurrentRound();
    }
    return true;
  }

  /** Reset the room to LOBBY for a rematch (host only). */
  rematch(actorId: string): boolean {
    if (actorId !== this.hostId) return false;
    if (this.phase !== 'ENDED') return false;
    this.phase = 'LOBBY';
    this.round = 0;
    this.history = [];
    this.choices = {};
    this.players = this.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      stage: 'ALIVE_CLOTHED',
      isBot: m.isBot,
    }));
    this.lastNarration = '';
    this.winnerId = null;
    this.broadcastSnapshot();
    return true;
  }

  // --- Internals ---------------------------------------------------------

  private beginRound(): void {
    this.round += 1;
    this.choices = {};
    // Auto-submit on behalf of every alive bot.
    for (const member of this.members) {
      if (!member.isBot || !member.bot) continue;
      const player = this.players.find((p) => p.id === member.id);
      if (!player || player.stage === 'DEAD') continue;
      const choice = member.bot.strategy.pickChoice(
        {
          selfId: member.id,
          round: this.round,
          players: this.players,
          history: this.history,
        },
        member.bot.rng,
      );
      this.choices[member.id] = choice;
    }
    this.broadcastSnapshot();
  }

  private allAliveSubmitted(): boolean {
    for (const player of this.players) {
      if (player.stage === 'DEAD') continue;
      if (this.choices[player.id] === undefined) return false;
    }
    return true;
  }

  private resolveCurrentRound(): void {
    const inputs: RoundInputs = { choices: { ...this.choices } };
    const result = resolveRound(this.players, this.round, inputs);
    this.players = result.players;
    this.lastNarration = result.narration;
    this.history = [
      ...this.history,
      {
        round: this.round,
        choices: { ...this.choices },
        ...(result.rps.winningChoice ? { winningChoice: result.rps.winningChoice } : {}),
      },
    ];

    this.broadcaster.emitRound({
      round: this.round,
      effects: result.effects,
      narration: result.narration,
      isGameOver: result.isGameOver,
      winnerId: result.winnerId,
    });

    if (result.isGameOver) {
      this.phase = 'ENDED';
      this.winnerId = result.winnerId;
      this.broadcastSnapshot();
      return;
    }

    // Schedule the next round to begin only after the current round's animation
    // finishes — uses the same canonical timing.ts constants the client honors.
    const isTie = result.rps.tie;
    const holdMs = isTie ? TIE_NARRATION_HOLD_MS : ROUND_TOTAL_MS;
    setTimeout(() => {
      if (this.phase === 'PLAYING') this.beginRound();
    }, holdMs);
  }

  private broadcastSnapshot(): void {
    this.broadcaster.emitSnapshot(this.snapshot());
  }

  snapshot(): RoomSnapshot {
    return {
      roomId: this.roomId,
      hostId: this.hostId,
      phase: this.phase,
      round: this.round,
      players: this.members.map((m) => {
        const p = this.players.find((pp) => pp.id === m.id);
        return {
          id: m.id,
          nickname: m.nickname,
          isBot: m.isBot,
          stage: p?.stage ?? 'DEAD',
          isHost: m.id === this.hostId,
          hasSubmitted: this.choices[m.id] !== undefined,
        };
      }),
      lastNarration: this.lastNarration,
      winnerId: this.winnerId,
    };
  }
}
