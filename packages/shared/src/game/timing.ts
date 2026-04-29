// Single source of truth for animation phase durations (in milliseconds).
//
// These constants drive the round-action choreography end-to-end:
//   - the headless sim CLI advances its virtual clock by these numbers,
//   - the Socket.IO server emits Effect[] with these durations,
//   - the PixiJS client tweens sprite/camera state over these intervals.
//
// FINAL_GOAL §A5 mandates that no other file in the repo hard-codes these
// values; everything imports from here. The five-phase action timeline
// (PREP → RUSH → PULL_PANTS → STRIKE → IMPACT → RETURN) sums to exactly
// ACTION_TOTAL_MS, by spec.
//
//   PREP        300ms    [    0 →   300]   anticipation crouch
//   RUSH        600ms    [  300 →   900]   sprint to victim with dust
//   PULL_PANTS  900ms    [  900 →  1800]   the 扒裤衩 reveal
//   STRIKE      600ms    [ 1800 →  2400]   knife wind-up + chop
//   IMPACT      800ms    [ 2400 →  3200]   shake + wood chip burst
//   RETURN      800ms    [ 3200 →  4000]   attacker walks back
//                       ─────
//                        4000ms = ACTION_TOTAL_MS

export const PHASE_T_PREP = 300;
export const PHASE_T_RUSH = 600;
export const PHASE_T_PULL_PANTS = 900;
export const PHASE_T_STRIKE = 600;
export const PHASE_T_IMPACT = 800;
export const PHASE_T_RETURN = 800;
export const ACTION_TOTAL_MS = 4000;
export const TIE_NARRATION_HOLD_MS = 2000;
export const SHAME_FRAME_HOLD_MS = 400;
