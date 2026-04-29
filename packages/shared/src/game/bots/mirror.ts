// Mirror bot — copies whatever the most recent winning shape was. If the
// last round was a tie or the first round, picks randomly. Tends to
// converge with other mirrors which is why we deliberately diversify
// strategies via the registry.

import { RPS_CHOICES, type RpsChoice } from '../rps.js';
import { pickOne, type Rng } from './seedRng.js';
import type { BotContext, BotStrategy } from './types.js';

/** 1 in N rounds, deviate randomly to avoid being trivially countered. */
const NOISE_DENOMINATOR = 7;

export const mirrorStrategy: BotStrategy = {
  kind: 'mirror',
  pickChoice(ctx: BotContext, rng: Rng): RpsChoice {
    if (ctx.history.length === 0) return pickOne(rng, RPS_CHOICES);
    if (Math.floor(rng() * NOISE_DENOMINATOR) === 0) return pickOne(rng, RPS_CHOICES);

    // Walk back from latest to earliest looking for the last decisive round.
    for (let i = ctx.history.length - 1; i >= 0; i--) {
      const w = ctx.history[i]!.winningChoice;
      if (w !== undefined) return w;
    }
    return pickOne(rng, RPS_CHOICES);
  },
};
