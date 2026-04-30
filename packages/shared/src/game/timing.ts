// Single source of truth for animation phase durations (in milliseconds).
//
// These constants drive the round-action choreography end-to-end:
//   - the headless sim CLI advances its virtual clock by these numbers,
//   - the Socket.IO server emits Effect[] with these durations,
//   - the PixiJS client tweens sprite/camera state over these intervals.
//
// FINAL_GOAL §A5 mandates that no other file in the repo hard-codes these
// values; everything imports from here. The 7-phase round timeline
// (REVEAL → PREP → RUSH → PULL_PANTS → STRIKE → IMPACT → RETURN) sums to
// exactly ROUND_TOTAL_MS, by spec. The action sub-segment (PREP→RETURN)
// still totals ACTION_TOTAL_MS so older callers reading the action duration
// keep working.
//
//   REVEAL     1500ms    [    0 →  1500]   simultaneous throw glyphs
//   PREP        300ms    [ 1500 →  1800]   anticipation crouch
//   RUSH        600ms    [ 1800 →  2400]   sprint to victim with dust
//   PULL_PANTS  900ms    [ 2400 →  3300]   the 扒裤衩 reveal
//   STRIKE      600ms    [ 3300 →  3900]   knife wind-up + chop
//   IMPACT      800ms    [ 3900 →  4700]   shake + wood chip burst
//   RETURN      800ms    [ 4700 →  5500]   attacker walks back
//                       ─────
//                        5500ms = ROUND_TOTAL_MS
//                        4000ms = ACTION_TOTAL_MS  (PREP→RETURN segment)

/**
 * REVEAL phase — held BEFORE the action timeline starts. Long enough for a
 * first-time viewer to scan the screen and intuitively count the throw
 * distribution ("2 fists, 1 paper, so paper wins"), per FINAL_GOAL §H2.
 */
export const PHASE_T_REVEAL = 1500;
export const PHASE_T_PREP = 300;
export const PHASE_T_RUSH = 600;
export const PHASE_T_PULL_PANTS = 900;
export const PHASE_T_STRIKE = 600;
export const PHASE_T_IMPACT = 800;
export const PHASE_T_RETURN = 800;
/** Duration of the action sub-segment only (PREP through RETURN). Kept for
 *  callers that talk about "how long an action plays". */
export const ACTION_TOTAL_MS = 4000;
/** Total round duration (REVEAL + action). What the server holds before
 *  beginning the next round on a non-tie path. */
export const ROUND_TOTAL_MS = PHASE_T_REVEAL + ACTION_TOTAL_MS;
export const TIE_NARRATION_HOLD_MS = 2000;
export const SHAME_FRAME_HOLD_MS = 400;
