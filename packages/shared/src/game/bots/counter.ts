// Counter bot — throws what would beat the most-frequent shape an opponent
// has thrown so far. On the first round (no history yet) it picks
// uniformly at random. Adds a small chance of throwing randomly to avoid
// being itself read-as-a-pattern.

import { RPS_CHOICES, type RpsChoice } from '../rps.js';
import { pickOne, type Rng } from './seedRng.js';
import type { BotContext, BotStrategy } from './types.js';

const BEATEN_BY: Readonly<Record<RpsChoice, RpsChoice>> = {
  // The shape that BEATS the key. e.g. ROCK is beaten by PAPER.
  ROCK: 'PAPER',
  PAPER: 'SCISSORS',
  SCISSORS: 'ROCK',
};

/** 1 in N rounds, throw randomly instead of countering — avoids being trivially mirrored. */
const NOISE_DENOMINATOR = 6;

export const counterStrategy: BotStrategy = {
  kind: 'counter',
  pickChoice(ctx: BotContext, rng: Rng): RpsChoice {
    if (ctx.history.length === 0) return pickOne(rng, RPS_CHOICES);
    if (Math.floor(rng() * NOISE_DENOMINATOR) === 0) return pickOne(rng, RPS_CHOICES);

    // Count opponent throws across all history. Prefer the most recent
    // round's distribution (weighted) so the bot adapts quickly.
    const counts: Record<RpsChoice, number> = { ROCK: 0, PAPER: 0, SCISSORS: 0 };
    const lastIdx = ctx.history.length - 1;
    for (let i = 0; i < ctx.history.length; i++) {
      const entry = ctx.history[i]!;
      const weight = i === lastIdx ? 3 : 1; // recency bias
      for (const [pid, choice] of Object.entries(entry.choices)) {
        if (pid === ctx.selfId) continue;
        counts[choice] += weight;
      }
    }

    // Find the most-thrown opponent shape; ties broken by canonical order.
    let dominant: RpsChoice = 'ROCK';
    let best = -1;
    for (const c of RPS_CHOICES) {
      if (counts[c] > best) {
        best = counts[c];
        dominant = c;
      }
    }
    return BEATEN_BY[dominant];
  },
};
