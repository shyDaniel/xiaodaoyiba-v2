// @xdyb/server — headless sim CLI entry.
//
// FINAL_GOAL §A1/A2/B2 acceptance gate. Runs N rounds of resolveRound() with
// bot-driven inputs, no Socket.IO, no React, no browser. One JSONL row per
// round; one final summary line.
//
// Usage:
//   pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 50 --seed 42
//
// Flags (all optional; defaults make a 4-player 20-round demo run):
//   --players  N        Number of players (1 human-shaped + (N-1) bots).
//                       Default: 4.
//   --bots     LIST     Comma-separated list of bot kinds. Each kind is one
//                       of: counter, random, iron, mirror. The first slot
//                       (player 0) is treated as human-shaped and uses
//                       `random` regardless. If LIST is shorter than (N-1)
//                       it cycles round-robin; if longer, the tail is
//                       ignored.  Default: 'counter,random,iron,mirror'.
//   --rounds   R        Maximum number of *games* worth of rounds to play.
//                       The sim plays back-to-back games until R total
//                       rounds have been emitted, then stops mid-game if
//                       necessary.  Default: 20.
//   --seed     S        Integer seed for reproducibility.  Default: a
//                       Date.now()-derived seed (non-reproducible).
//   --format   FMT      'human' (default, grep-able key=val) or 'jsonl'.
//   --quiet             Suppress per-round lines; print summary only.
//   --help / -h         Print usage and exit 0.

import {
  ACTION_TOTAL_MS,
  BOT_STRATEGIES,
  getBotStrategy,
  isBotKind,
  resetBotCaches,
  resolveRound,
  seededRng,
  SHARED_PACKAGE_VERSION,
  type BotContext,
  type BotKind,
  type BotStrategy,
  type Effect,
  type PlayerState,
  type RoundHistoryEntry,
  type RoundInputs,
  type Rng,
  type RpsChoice,
} from '@xdyb/shared';

interface ParsedArgs {
  players: number;
  bots: BotKind[];
  rounds: number;
  seed: number;
  format: 'human' | 'jsonl';
  quiet: boolean;
  help: boolean;
}

const HELP = `xdyb-sim — headless game simulator (shared@${SHARED_PACKAGE_VERSION})

Usage:
  pnpm sim [--players N] [--bots LIST] [--rounds R] [--seed S]
           [--format human|jsonl] [--quiet]

Flags:
  --players  Players in the room (default 4). Player 0 is human-shaped
             (acts via 'random' strategy); the rest are bots.
  --bots     Comma-separated bot kinds: counter,random,iron,mirror.
             Cycles round-robin if shorter than --players-1.
             Default: counter,random,iron,mirror
  --rounds   Total round budget across back-to-back games (default 20).
  --seed     Integer seed for reproducibility (default: time-based).
  --format   'human' (default, key=val) or 'jsonl' (one JSON per line).
  --quiet    Suppress per-round output; print only the final summary.
  -h, --help Show this help and exit.

Examples:
  pnpm sim --players 4 --bots counter,random,iron,mirror --rounds 50 --seed 42
  pnpm sim --rounds 200 --seed 1 --format jsonl --quiet
`;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {
    players: 4,
    bots: ['counter', 'random', 'iron', 'mirror'],
    rounds: 20,
    seed: (Date.now() & 0x7fffffff) >>> 0,
    format: 'human',
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const peek = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`flag ${a} requires a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '-h':
      case '--help':
        out.help = true;
        break;
      case '--players': {
        const n = Number.parseInt(peek(), 10);
        if (!Number.isFinite(n) || n < 2 || n > 8) {
          throw new Error(`--players must be an integer in [2, 8], got: ${n}`);
        }
        out.players = n;
        break;
      }
      case '--bots': {
        const raw = peek();
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        if (parts.length === 0) throw new Error('--bots list is empty');
        for (const p of parts) {
          if (!isBotKind(p)) {
            throw new Error(
              `--bots: unknown kind '${p}'. Valid: counter, random, iron, mirror.`,
            );
          }
        }
        out.bots = parts as BotKind[];
        break;
      }
      case '--rounds': {
        const n = Number.parseInt(peek(), 10);
        if (!Number.isFinite(n) || n < 1) {
          throw new Error(`--rounds must be a positive integer, got: ${n}`);
        }
        out.rounds = n;
        break;
      }
      case '--seed': {
        const raw = peek();
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n)) {
          throw new Error(`--seed must be an integer, got: ${raw}`);
        }
        out.seed = (n & 0xffffffff) >>> 0;
        break;
      }
      case '--format': {
        const v = peek();
        if (v !== 'human' && v !== 'jsonl') {
          throw new Error(`--format must be 'human' or 'jsonl', got: ${v}`);
        }
        out.format = v;
        break;
      }
      case '--quiet':
        out.quiet = true;
        break;
      default:
        throw new Error(`unknown flag: ${a} (try --help)`);
    }
  }
  return out;
}

interface BotSlot {
  id: string;
  nickname: string;
  isBot: boolean;
  strategy: BotStrategy;
  rng: Rng;
}

function buildSlots(args: ParsedArgs): BotSlot[] {
  const slots: BotSlot[] = [];
  const roomId = `sim-${args.seed}`;

  // Player 0: human-shaped slot, but driven by `random` so the sim is
  // self-contained. Distinct id so its seed is independent from any bot.
  slots.push({
    id: 'p0',
    nickname: '玩家',
    isBot: false,
    strategy: getBotStrategy('random'),
    rng: seededRng(args.seed, roomId, 'p0'),
  });

  for (let i = 1; i < args.players; i++) {
    // Round-robin over the user-supplied bot list (NOT the global registry),
    // so `--bots iron,iron,iron` honors the user's intent and `--bots
    // counter,random,iron,mirror` produces one of each in a 4-player game.
    const kind = args.bots[(i - 1) % args.bots.length]!;
    const strategy = getBotStrategy(kind);
    const id = `bot-${i}-${kind}`;
    slots.push({
      id,
      nickname: kind,
      isBot: true,
      strategy,
      rng: seededRng(args.seed, roomId, id),
    });
  }
  return slots;
}

function freshPlayers(slots: ReadonlyArray<BotSlot>): PlayerState[] {
  return slots.map((s) => ({
    id: s.id,
    nickname: s.nickname,
    stage: 'ALIVE_CLOTHED',
    isBot: s.isBot,
  }));
}

interface RoundReport {
  game: number;
  round: number;
  gameRound: number;
  throws: Array<readonly [string, RpsChoice]>;
  winners: string[];
  losers: string[];
  action: 'PULL_PANTS' | 'CHOP' | 'TIE' | 'NONE';
  target: string | null;
  narration: string;
  isGameOver: boolean;
  winnerId: string | null;
  isTie: boolean;
}

interface SummaryStats {
  games: number;
  rounds: number;
  ties: number;
  durationMs: number;
  winners: string[];
  winsByPlayer: Record<string, number>;
  throwsByPlayer: Record<string, number>;
}

function pickAction(effects: ReadonlyArray<Effect>): {
  action: RoundReport['action'];
  target: string | null;
} {
  for (const e of effects) {
    if (e.type === 'ACTION') {
      if (e.kind === 'PULL_PANTS' || e.kind === 'CHOP') {
        return { action: e.kind, target: e.target };
      }
    }
  }
  return { action: 'NONE', target: null };
}

function runSim(args: ParsedArgs): { stats: SummaryStats; reports: RoundReport[] } {
  resetBotCaches();
  const slots = buildSlots(args);

  const stats: SummaryStats = {
    games: 0,
    rounds: 0,
    ties: 0,
    durationMs: 0,
    winners: [],
    winsByPlayer: Object.fromEntries(slots.map((s) => [s.id, 0])),
    throwsByPlayer: Object.fromEntries(slots.map((s) => [s.id, 0])),
  };
  const reports: RoundReport[] = [];

  const start = process.hrtime.bigint();

  let game = 1;
  let players: PlayerState[] = freshPlayers(slots);
  let history: RoundHistoryEntry[] = [];
  let gameRound = 0;

  // Per-game ceiling so a degenerate strategy can't loop forever even if
  // the engine somehow stalls. Generous vs §A2's 5-15 round expectation.
  const PER_GAME_CAP = 200;

  while (stats.rounds < args.rounds) {
    gameRound += 1;
    if (gameRound > PER_GAME_CAP) {
      process.stderr.write(
        `[sim] warn: game ${game} exceeded ${PER_GAME_CAP} rounds; force-restarting\n`,
      );
      players = freshPlayers(slots);
      history = [];
      gameRound = 1;
      game += 1;
      continue;
    }

    // Build BotContext + ask each alive player for a choice.
    const choices: Record<string, RpsChoice> = {};
    const orderedThrows: Array<readonly [string, RpsChoice]> = [];
    for (const slot of slots) {
      const player = players.find((p) => p.id === slot.id)!;
      if (player.stage === 'DEAD') continue;
      const ctx: BotContext = {
        selfId: slot.id,
        round: gameRound,
        players,
        history,
      };
      const choice = slot.strategy.pickChoice(ctx, slot.rng);
      choices[slot.id] = choice;
      orderedThrows.push([slot.id, choice] as const);
      stats.throwsByPlayer[slot.id] = (stats.throwsByPlayer[slot.id] ?? 0) + 1;
    }

    const inputs: RoundInputs = { choices };
    const result = resolveRound(players, gameRound, inputs);
    stats.rounds += 1;

    const isTie = result.rps.tie;
    if (isTie) stats.ties += 1;

    const { action, target } = pickAction(result.effects);
    const report: RoundReport = {
      game,
      round: stats.rounds,
      gameRound,
      throws: orderedThrows,
      winners: [...result.rps.winners],
      losers: [...result.rps.losers],
      action: isTie ? 'TIE' : action,
      target,
      narration: result.narration,
      isGameOver: result.isGameOver,
      winnerId: result.winnerId,
      isTie,
    };
    reports.push(report);
    if (!args.quiet) emitRound(report, args.format);

    history = [
      ...history,
      {
        round: gameRound,
        choices: { ...choices },
        ...(result.rps.winningChoice
          ? { winningChoice: result.rps.winningChoice }
          : {}),
      },
    ];
    players = result.players;

    if (result.isGameOver) {
      stats.games += 1;
      if (result.winnerId !== null) {
        stats.winners.push(result.winnerId);
        stats.winsByPlayer[result.winnerId] =
          (stats.winsByPlayer[result.winnerId] ?? 0) + 1;
      }
      players = freshPlayers(slots);
      history = [];
      gameRound = 0;
      game += 1;
    }
  }

  const end = process.hrtime.bigint();
  stats.durationMs = Number((end - start) / 1_000_000n);

  return { stats, reports };
}

function emitRound(r: RoundReport, format: ParsedArgs['format']): void {
  if (format === 'jsonl') {
    process.stdout.write(
      JSON.stringify({
        round: r.round,
        game: r.game,
        gameRound: r.gameRound,
        throws: r.throws.map(([id, c]) => ({ id, choice: c })),
        winners: r.winners,
        losers: r.losers,
        action: r.action,
        target: r.target,
        narration: r.narration,
        isTie: r.isTie,
        isGameOver: r.isGameOver,
        winnerId: r.winnerId,
      }) + '\n',
    );
    return;
  }
  // Human format. Quote the narration to keep grep-able tokens stable.
  const throws = r.throws.map(([, c]) => c).join(',');
  const winners = r.winners.join(',');
  const losers = r.losers.join(',');
  const target = r.target ?? '-';
  const narration = r.narration.replaceAll('\n', ' / ');
  process.stdout.write(
    `round=${r.round} game=${r.game} gameRound=${r.gameRound} ` +
      `throws=[${throws}] winners=[${winners}] losers=[${losers}] ` +
      `action=${r.action} target=${target} narration="${narration}"\n`,
  );
}

function emitSummary(stats: SummaryStats, args: ParsedArgs): void {
  const lastWinner = stats.winners[stats.winners.length - 1] ?? '-';
  const tieRate = stats.rounds > 0 ? stats.ties / stats.rounds : 0;
  const winsKv = Object.entries(stats.winsByPlayer)
    .map(([id, n]) => `${id}:${n}`)
    .join(',');
  const throwsKv = Object.entries(stats.throwsByPlayer)
    .map(([id, n]) => `${id}:${n}`)
    .join(',');

  process.stdout.write('=== summary ===\n');
  process.stdout.write(
    `games=${stats.games} rounds=${stats.rounds} ties=${stats.ties} ` +
      `tie_rate=${tieRate.toFixed(3)} winner=${lastWinner} ` +
      `winners=[${stats.winners.join(',')}] ` +
      `wins_by_player={${winsKv}} ` +
      `throws_by_player={${throwsKv}} ` +
      `seed=${args.seed} action_total_ms=${ACTION_TOTAL_MS} ` +
      `duration_ms=${stats.durationMs}\n`,
  );

  if (stats.rounds >= 20) {
    if (tieRate >= 0.30) {
      process.stderr.write(
        `[sim] warn: tie_rate=${tieRate.toFixed(3)} >= 0.30 (FINAL_GOAL §A2 budget)\n`,
      );
    }
    const totalWins = stats.winners.length;
    if (totalWins >= 2) {
      for (const [id, n] of Object.entries(stats.winsByPlayer)) {
        if (n / totalWins > 0.60) {
          process.stderr.write(
            `[sim] warn: ${id} wins ${n}/${totalWins} (>60%; FINAL_GOAL §A2 budget)\n`,
          );
        }
      }
    }
  }
}

function listStrategies(): string {
  return BOT_STRATEGIES.map((s) => s.kind).join(', ');
}

export function main(argv: readonly string[]): number {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(HELP);
    process.stdout.write(`\nRegistered strategies: ${listStrategies()}\n`);
    return 0;
  }
  if (args.players - 1 > args.bots.length && !args.quiet) {
    process.stderr.write(
      `[sim] info: ${args.players - 1} bot slots from list of ${args.bots.length}; cycling round-robin\n`,
    );
  }

  const { stats } = runSim(args);
  emitSummary(stats, args);
  return 0;
}

// Auto-execute when invoked as a script (tsx src/sim.ts ... or node dist/sim.js).
const isDirect = (() => {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('sim.ts') || entry.endsWith('sim.js');
})();

if (isDirect) {
  const code = main(process.argv.slice(2));
  process.exit(code);
}

export { parseArgs, runSim, emitSummary, type ParsedArgs };
