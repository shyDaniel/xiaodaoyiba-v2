// Iron bot — picks a single favorite shape on creation and almost always
// throws it. Behaves as a stubborn opponent that exploits players who try
// to be too clever. Adds occasional noise so it isn't 100% predictable.
//
// The favorite shape is derived from the RNG's first value, which means
// the per-bot seed (deriveBotSeed) determines whether this iron is a
// rock, paper, or scissors iron. Two `iron` bots in the same room with
// different ids therefore favor different shapes.

import { RPS_CHOICES, type RpsChoice } from '../rps.js';
import { pickOne, type Rng } from './seedRng.js';
import type { BotContext, BotStrategy } from './types.js';

/** 1 in N rounds, deviate to a random other shape. */
const DEVIATION_DENOMINATOR = 5;

// Per-bot favorite cache. Keyed by `selfId` so we don't recompute every
// round and so the favorite is stable across rounds for the same bot.
const favoriteCache = new Map<string, RpsChoice>();

export const ironStrategy: BotStrategy = {
  kind: 'iron',
  pickChoice(ctx: BotContext, rng: Rng): RpsChoice {
    let fav = favoriteCache.get(ctx.selfId);
    if (fav === undefined) {
      fav = pickOne(rng, RPS_CHOICES);
      favoriteCache.set(ctx.selfId, fav);
    }
    if (Math.floor(rng() * DEVIATION_DENOMINATOR) === 0) {
      const others = RPS_CHOICES.filter((c) => c !== fav);
      return pickOne(rng, others);
    }
    return fav;
  },
};

/** Test/sim helper: clear the favorite cache between sim runs so seeded
 *  reproducibility holds across multiple invocations in the same process. */
export function _resetIronFavorites(): void {
  favoriteCache.clear();
}
