/**
 * Named SFX presets — FINAL_GOAL §D1.
 *
 * Each preset is a 0-arg function so `play(name)` is the only API the rest
 * of the client needs. Tunings are inherited from v1 and tuned by ear; if
 * you tweak one, run `pnpm dev` and click around — the goal is "obvious
 * audio category" (rip vs chop vs thud) not literalism.
 *
 * The 9 names listed by FINAL_GOAL are the lower-case identifiers below;
 * `clothTear` and `gasp` are bonus voices used inside the PULL_PANTS beat.
 */

import { zzfx } from './zzfx.js';

/** UI tap — short coin-blip on hand pick. */
function tap(): void {
  zzfx(1, 0, 380, 0.01, 0.04, 0.06, 1, 1.7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02);
}

/** Big "reveal" gong-ish — used when an action round resolves. */
function reveal(): void {
  zzfx(1, 0.05, 110, 0.02, 0.08, 0.5, 2, 1.4, 0, 0, 0, 0, 0.05, 0.2, 0, 0.1, 0, 0.7, 0.1);
}

/** Pull-pants — slidey whoop. Plays at PHASE_T_PULL_PANTS start. */
function pull(): void {
  zzfx(1, 0.05, 290, 0.01, 0.12, 0.18, 1, 1.4, -8, 0, 0, 0, 0, 0, 12, 0, 0, 0.8, 0.04);
}

/** Cloth-tear — noisy "嘶啦" rip. Layered on PULL for fabric texture. */
function clothTear(): void {
  zzfx(0.9, 0.2, 220, 0.005, 0.08, 0.18, 4, 1.1, -2, 0, 0, 0, 0, 2.4, 0, 0.6, 0, 0.7, 0.04);
  setTimeout(
    () => zzfx(0.7, 0.1, 180, 0, 0.04, 0.14, 3, 0.9, -10, 0, 0, 0, 0, 1.6, 0, 0.4, 0, 0.6, 0.05),
    80,
  );
}

/** Gasp — short cartoon "啊!" inhale on victim during PULL_PANTS. */
function gasp(): void {
  zzfx(0.9, 0.1, 880, 0.02, 0.06, 0.12, 1, 1.5, 6, 0, 0, 0, 0, 0.05, 0, 0, 0, 0.85, 0.04, 0.15);
}

/** Chop — sharp metallic tick. Plays at STRIKE start. */
function chop(): void {
  zzfx(1, 0.05, 1200, 0, 0.02, 0.16, 4, 1.6, 0, 0, 0, 0, 0, 0.6, 0, 0.2, 0, 0.8, 0.02);
}

/** Dodge — quick rising blip. Reserved for future evade UX. */
function dodge(): void {
  zzfx(1, 0.02, 520, 0.01, 0.05, 0.08, 0, 1.2, 18, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.02);
}

/** House damage — low thud. Plays at IMPACT phase. */
function thud(): void {
  zzfx(1, 0.05, 80, 0.02, 0.04, 0.22, 3, 0.8, 0, 0, 0, 0, 0, 1.5, 0, 0.4, 0, 0.7, 0.05);
}

/** Round-start — ding ding. Plays at the start of every round. */
function roundStart(): void {
  zzfx(1, 0, 660, 0.01, 0.06, 0.1, 0, 1.6, 0, 0, 220, 0.04, 0, 0, 0, 0, 0, 0.8, 0.02);
}

/** Victory — C-E-G-C rising arpeggio + bass warmth + flourish. */
function victory(): void {
  zzfx(1, 0, 523, 0.02, 0.1, 0.18, 0, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02);
  setTimeout(
    () => zzfx(1, 0, 659, 0.02, 0.1, 0.18, 0, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02),
    120,
  );
  setTimeout(
    () => zzfx(1, 0, 784, 0.02, 0.1, 0.18, 0, 1.4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.02),
    240,
  );
  setTimeout(
    () => zzfx(1, 0, 1047, 0.02, 0.18, 0.42, 0, 1.5, 0, 0, 0, 0, 0, 0.05, 0, 0, 0, 0.9, 0.04),
    360,
  );
  setTimeout(
    () => zzfx(0.7, 0, 261, 0.02, 0.2, 0.4, 2, 1.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.05),
    360,
  );
  setTimeout(
    () => zzfx(0.6, 0, 1568, 0.01, 0.08, 0.3, 0, 1.6, 0, 0, 0, 0, 0, 0.02, 0, 0, 0, 0.9, 0.03),
    620,
  );
}

/** Defeat — falling minor third. */
function defeat(): void {
  zzfx(1, 0, 392, 0.02, 0.1, 0.2, 1, 1.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.04);
  setTimeout(
    () => zzfx(1, 0, 311, 0.02, 0.16, 0.3, 1, 1.3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.7, 0.06),
    180,
  );
}

export const SFX = {
  tap,
  reveal,
  pull,
  clothTear,
  gasp,
  chop,
  dodge,
  thud,
  roundStart,
  victory,
  defeat,
} satisfies Record<string, () => void>;

export type SfxName = keyof typeof SFX;

/** Fire a named preset. No-op when muted (zzfx() guards). */
export function play(name: SfxName): void {
  SFX[name]();
}
