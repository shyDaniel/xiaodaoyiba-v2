// EffectPlayer — the canvas-side consumer of the engine's Effect[] timeline.
//
// What this is
// ------------
// The pure `resolveRound()` engine emits a flat ordered list of `Effect`
// objects with `atMs` offsets relative to the round's t=0. Three consumers
// read the same list:
//
//   1. Headless sim CLI — ignores time, just inspects events.
//   2. Socket.IO server — relays the list to clients verbatim.
//   3. The browser EffectPlayer (this file) — reads `atMs` / `durationMs`
//      and schedules canvas state transitions (character.moveTo,
//      character.setState, character.slideTopPantsDown) at the right
//      offsets so the title verb 冲 (rush) reads as actual on-stage motion
//      and the 扒裤衩 reveal animates pants waist→ankle.
//
// Before this file existed, Game.tsx scheduled state via setTimeout chains
// that mutated React state — so PHASE_START never reached the canvas, the
// BattleLog narrated "一个箭步上前" while the sprite stood still, and the
// title verb had zero visible motion. EffectPlayer is the bridge: React
// owns no per-frame state, the engine emits the timeline, and the canvas
// dispatches it.

import type {
  Effect,
  PlayerId,
  PlayerState,
} from '@xdyb/shared';
import {
  PHASE_T_PULL_PANTS,
  PHASE_T_REVEAL,
  PHASE_T_RUSH,
  PHASE_T_STRIKE,
  ROUND_TOTAL_MS,
  TIE_NARRATION_HOLD_MS,
} from '@xdyb/shared';
import type { Character } from './characters/Character.js';
import type { Camera } from './camera/index.js';
import { play as playSfx } from '../audio/presets.js';

/** A subset of the four particle emitters EffectPlayer drives. The host
 *  (GameStage) owns the actual instances; EffectPlayer just calls
 *  `spawn(count, x, y)` at the right phase boundaries. The interface is
 *  intentionally minimal so a future server-driven emitter ID protocol
 *  can swap in. */
export interface ParticleSink {
  spawn(count: number, originX: number, originY: number): void;
}

/** Lookup contract the player needs from its host (GameStage). The host
 *  owns the Pixi scene graph; EffectPlayer is stateless w.r.t. positions
 *  and queries the host on every dispatch. */
export interface EffectPlayerScene {
  /** Get the live Character instance for a player id, or undefined if it
   *  was reconciled away mid-round (defensive — should not happen). */
  getCharacter(id: PlayerId): Character | undefined;
  /** World x of the character's home spot — where they idle. Read once at
   *  action start so a mid-action layout reflow does not desync the rush
   *  approach-side computation. (§K2: actor stays at target through round
   *  end; reset() snaps them home before the next PREP.) */
  getHomeX(id: PlayerId): number | undefined;
  /** Optional particle channels. EffectPlayer spawns into them at the
   *  right phase beats; if absent, particle calls are silent no-ops so
   *  the player still works on a barebones scene (e.g. unit tests). */
  dust?: ParticleSink;
  cloth?: ParticleSink;
  woodChips?: ParticleSink;
  confetti?: ParticleSink;
  /** Optional camera handle. EffectPlayer fires shake() and zoomTo()
   *  at PHASE_START boundaries (FINAL_GOAL §C4). Absent on barebones
   *  scenes (e.g. unit tests) — calls degrade to silent no-ops. */
  camera?: Camera;
  /** Optional viewport dims for confetti positioning (centered top of
   *  screen). Falls back to 0 if not provided. */
  getViewportSize?: () => { width: number; height: number };
  /** §H2 REVEAL phase glyph layer. The host renders a ≥64px gesture
   *  glyph above each alive player's station for PHASE_T_REVEAL ms.
   *  Optional so unit tests can run without supplying a layer; calls
   *  degrade to silent no-ops in that case. */
  revealGlyphs?: {
    show(
      throws: ReadonlyArray<{
        playerId: PlayerId;
        choice: 'ROCK' | 'PAPER' | 'SCISSORS';
      }>,
    ): void;
    hide(): void;
  };
}

export interface PlayEffectsOptions {
  /** Fired with the latest narration text, optionally tagged with a
   *  per-effect `atMs` so the host can append a BattleLog row at the
   *  same beat the canvas plays. The actor/target id pair is included
   *  so the host can color-code the row. */
  onNarration?: (entry: {
    atMs: number;
    text: string;
    verb: '扒' | '砍' | '闪' | '平' | '死' | '穿';
    actor?: PlayerId;
    target?: PlayerId;
  }) => void;
}

/** Schedule a callback at `targetMs` from the timeline anchor `t0`,
 *  using window.setTimeout. Returns the timer id so cancel() can clear
 *  pending dispatches when a new round comes in. */
function scheduleAt(
  timers: number[],
  t0: number,
  atMs: number,
  fn: () => void,
): void {
  const delay = Math.max(0, t0 + atMs - performance.now());
  const id = window.setTimeout(fn, delay);
  timers.push(id);
}

/**
 * EffectPlayer is owned by the GameStage host (one per stage, lifetime
 * tied to the Pixi Application). React's Game page calls `play(effects,
 * players, options)` on every round-resolve and awaits the returned
 * promise.
 *
 * The player is single-shot: a second `play()` call cancels any pending
 * timers from the prior round (defensive — under normal flow the host
 * awaits the previous play() before issuing a new one).
 */
export class EffectPlayer {
  private timers: number[] = [];
  private active = false;

  constructor(private readonly scene: EffectPlayerScene) {}

  /** Reset the action choreography to neutral: each character at its
   *  homeX, IDLE state. Called between rounds so the next round starts
   *  from a known pose. */
  reset(playerIds: ReadonlyArray<PlayerId>): void {
    for (const id of playerIds) {
      const ch = this.scene.getCharacter(id);
      const homeX = this.scene.getHomeX(id);
      if (!ch) continue;
      // Don't disturb DEAD pose (rotation/alpha).
      if (ch.getState() === 'DEAD') continue;
      ch.setState('IDLE');
      if (homeX !== undefined) {
        // Snap home rather than tween — the next round's RUSH should
        // start from a clean baseline.
        ch.view.x = homeX;
      }
    }
  }

  /** Cancel pending dispatches. Idempotent. Also resets the camera so
   *  a half-played zoom/shake doesn't leak into the next round (e.g.
   *  if the user navigates away mid-PULL_PANTS). */
  cancel(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    this.active = false;
    this.scene.camera?.reset();
    this.scene.revealGlyphs?.hide();
  }

  /** Returns true while a play() is in flight. */
  isActive(): boolean {
    return this.active;
  }

  /**
   * Play one round's Effect[] choreography on the canvas.
   *
   * Timeline (action round, t in ms from t0; FINAL_GOAL §K2 — no RETURN):
   *   0    REVEAL hold (RPS glyphs above stations, PHASE_T_REVEAL=1500)
   *   1500 PHASE_START PREP                     → actor: PREP
   *   1800 PHASE_START RUSH                     → actor: RUSH + moveTo(victim.spotX, RUSH=600ms)
   *   2400 PHASE_START PULL_PANTS + ACTION      → actor: PULL; victim: SHAME + slideTopPantsDown(900ms)
   *   3300 PHASE_START STRIKE                   → actor: STRIKE (CHOP rounds: blade connects, SET_STAGE→DEAD)
   *   3900 PHASE_START IMPACT                   → camera shake / particle burst; camera reset to neutral
   *   4700 ROUND_TOTAL_MS                       → resolve(); actor STAYS at target's house (reset()
   *                                                between rounds snaps them back home — §K2 "next
   *                                                PREP teleports them back").
   *
   * Tie round: TIE_NARRATION fires once at atMs=0; resolve() fires after
   * REVEAL + TIE_NARRATION_HOLD_MS (1500 + 2000 = 3500ms).
   */
  async play(
    effects: ReadonlyArray<Effect>,
    players: ReadonlyArray<PlayerState>,
    options: PlayEffectsOptions = {},
  ): Promise<void> {
    this.cancel();
    this.active = true;
    const t0 = performance.now();

    // Helper: nickname lookup by id (used by narration emitter).
    const nicknameById = new Map<PlayerId, string>();
    for (const p of players) nicknameById.set(p.id, p.nickname);

    // ── REVEAL frame (FINAL_GOAL §H2) ──────────────────────────────────
    // Render every alive player's chosen shape as a ≥64px glyph above
    // their station for the entire reveal hold. Fires for both tie and
    // action paths, so a viewer counts the distribution before the
    // round outcome changes the screen. We emit at t=0 and auto-clear
    // at t=PHASE_T_REVEAL; the action timeline (or tie hold) starts
    // immediately after.
    const revealEffect = effects.find((e) => e.type === 'RPS_REVEAL');
    if (revealEffect && revealEffect.type === 'RPS_REVEAL') {
      playSfx('reveal');
      this.scene.revealGlyphs?.show(revealEffect.throws);
      scheduleAt(this.timers, t0, PHASE_T_REVEAL, () => {
        this.scene.revealGlyphs?.hide();
      });
    }

    // ── Tie path ────────────────────────────────────────────────────────
    const tie = effects.find((e) => e.type === 'TIE_NARRATION');
    if (tie && tie.type === 'TIE_NARRATION') {
      // No character motion on a tie — just emit the narration row, sit
      // for the canonical hold (after the reveal frame), then resolve.
      if (options.onNarration) {
        options.onNarration({
          atMs: 0,
          text: tie.text,
          verb: '平',
        });
      }
      // Reveal already played the cue sound. Hold for REVEAL + tie
      // narration so the glyphs stay readable through the whole tie
      // beat, then close.
      await waitMs(PHASE_T_REVEAL + TIE_NARRATION_HOLD_MS);
      this.scene.revealGlyphs?.hide();
      this.active = false;
      return;
    }

    // ── Action path ─────────────────────────────────────────────────────
    // Pull out actions + narrations. ACTION effects fire at PULL_PANTS
    // start (atMs=900); narrations are emitted at the same beat for
    // PULL_PANTS rounds and at STRIKE start (atMs=1800) for CHOP rounds.
    const actions = effects.filter(
      (e): e is Extract<Effect, { type: 'ACTION' }> => e.type === 'ACTION',
    );
    const narrations = effects.filter(
      (e): e is Extract<Effect, { type: 'NARRATION' }> => e.type === 'NARRATION',
    );

    // Schedule narration → host (e.g. BattleLog row append). One row per
    // narration effect; emit at its declared atMs so the on-stage beat
    // and the log row land in lockstep.
    for (const nar of narrations) {
      scheduleAt(this.timers, t0, nar.atMs, () => {
        if (options.onNarration) {
          options.onNarration({
            atMs: nar.atMs,
            text: nar.text,
            verb: nar.verb,
            actor: nar.actor,
            target: nar.target,
          });
        }
      });
    }

    // Schedule per-pairing character motion. The 5-phase action timeline
    // is the canonical FINAL_GOAL §A5/§K2 timing — durations imported
    // from timing.ts. atMs offsets here mirror PHASE_OFFSETS (REVEAL=0,
    // PREP=1500, RUSH=1800, PULL_PANTS=2400, STRIKE=3300, IMPACT=3900)
    // but we use the ACTION effect's own atMs (=PULL_PANTS=2400) as the
    // engine's canonical anchor, then derive RUSH start as
    // (atMs - PHASE_T_RUSH) and IMPACT start as
    // (atMs + PHASE_T_PULL_PANTS + PHASE_T_STRIKE). §K2 dropped the
    // RETURN beat: the actor stays parented at the target's spot through
    // IMPACT and is teleported home by reset() before the next round's
    // PREP. This way a future change to timing.ts ripples through here
    // with no further edits.
    for (const action of actions) {
      const actor = this.scene.getCharacter(action.actor);
      const victim = this.scene.getCharacter(action.target);
      if (!actor || !victim) continue;

      const actorHomeX = this.scene.getHomeX(action.actor) ?? actor.view.x;
      const victimX = this.scene.getHomeX(action.target) ?? victim.view.x;

      // Stand a hair offset from the victim's spot so the actor doesn't
      // overlap the victim sprite. Sign chosen so the actor approaches
      // from the side they came from.
      const approach = actorHomeX <= victimX ? -52 : 52;
      const rushTargetX = victimX + approach;

      // PHASE_OFFSETS after §H2 + §K2:
      //   REVEAL=0, PREP=1500, RUSH=1800, PULL_PANTS=2400,
      //   STRIKE=3300, IMPACT=3900, ROUND_TOTAL_MS=4700.
      const atPullPants = action.atMs;                       // 2400
      const atRushStart = atPullPants - PHASE_T_RUSH;        // 1800
      const atStrike = atPullPants + PHASE_T_PULL_PANTS;     // 3300
      const atImpact = atStrike + PHASE_T_STRIKE;            // 3900

      // §K3 cinematic zoom-pan-zoom triplet. Total budget 1800ms:
      //   t=PULL_PANTS:        1.0 → 1.6 over 600ms (ease-out)
      //   t=PULL_PANTS+600:    HOLD 1.6 for 800ms (shame frame)
      //   t=PULL_PANTS+1400:   1.6 → 1.0 over 400ms (ease-in)
      // PULL_PANTS focal: midpoint of actor + target standing positions.
      // CHOP focal:       target's house door (victim.view shifted up to
      //                   roof/door height — ~96px above the feet line).
      const ZOOM_IN_MS = 600;
      const ZOOM_HOLD_MS = 800;
      const ZOOM_OUT_MS = 400;
      const ZOOM_PEAK = 1.6;
      const atZoomOut = atPullPants + ZOOM_IN_MS + ZOOM_HOLD_MS;

      // PREP: anticipation crouch. After §H2 the round opens with a
      // REVEAL hold, so PREP starts at PHASE_T_REVEAL (1500ms), not
      // t=0. Derived from the ACTION effect's canonical atMs anchor
      // so a future timing.ts edit ripples through here automatically.
      const atPrep = atRushStart - 300; // PHASE_T_PREP=300
      scheduleAt(this.timers, t0, atPrep, () => {
        actor.setState('PREP');
      });

      // RUSH: lean + sprint to victim. The title verb 冲.
      scheduleAt(this.timers, t0, atRushStart, () => {
        actor.setState('RUSH');
        // ease-out for punchy decel into the victim
        void actor.moveTo(rushTargetX, PHASE_T_RUSH, 'out');
        // Dust kicks: 4 staggered bursts of 3 motes from the actor's
        // feet across PHASE_T_RUSH=600ms — sums to ≥ 12 motes total
        // (FINAL_GOAL §C3 specifies ≥ 8 per step). Each later burst
        // tracks the actor's current x (queried at fire time) so the
        // trail follows the rush.
        const dust = this.scene.dust;
        if (dust) {
          for (let k = 0; k < 4; k++) {
            const delay = k * (PHASE_T_RUSH / 4);
            scheduleAt(this.timers, t0, atRushStart + delay, () => {
              const ax = actor.view.x;
              const ay = actor.view.y;
              dust.spawn(3, ax, ay + 4);
            });
          }
        }
      });

      // PULL_PANTS: actor grabs (PULL pose); victim cringes (SHAME pose)
      // and the top-pants slide kicks off. The slide takes the full
      // PHASE_T_PULL_PANTS=900ms (waist→ankle).
      scheduleAt(this.timers, t0, atPullPants, () => {
        if (action.kind === 'PULL_PANTS') {
          actor.setState('PULL');
          victim.setState('SHAME');
          victim.slideTopPantsDown(PHASE_T_PULL_PANTS);
          // §K3 cinematic zoom IN: 1.0 → 1.6× over 600ms ease-out, focal
          // at the midpoint of actor + target so both faces fill the
          // frame as the briefs drop. The HOLD is "do nothing" — the
          // camera tween completes and scale stays at 1.6 until the
          // matching ZOOM-OUT scheduled at atZoomOut fires.
          const focalX = (actor.view.x + victim.view.x) / 2;
          const focalY = (actor.view.y + victim.view.y) / 2 - 48;
          this.scene.camera?.zoomTo(
            focalX,
            focalY,
            ZOOM_PEAK,
            ZOOM_IN_MS,
            'out',
          );
          // SFX stack: pull whoop + cloth tear (layered) + a victim gasp
          // 60ms in so the voice reads as reaction not part of the rip.
          playSfx('pull');
          playSfx('clothTear');
          window.setTimeout(() => playSfx('gasp'), 60);
          // Cloth scraps: 3 staggered bursts (5 + 5 + 4 = 14, ≥ 12 spec)
          // across PHASE_T_PULL_PANTS=900ms, originating at the victim's
          // waist (the character's local y=0 is roughly the waist line
          // — see Character.ts TOP_PANTS_Y_WAIST). World y is the
          // victim's view.y (feet) minus a body-height offset (~64px).
          const cloth = this.scene.cloth;
          if (cloth) {
            const cx = victim.view.x;
            const cy = victim.view.y - 64;
            const counts = [5, 5, 4];
            for (let k = 0; k < counts.length; k++) {
              const c = counts[k] ?? 0;
              const delay = k * (PHASE_T_PULL_PANTS / counts.length);
              scheduleAt(this.timers, t0, atPullPants + delay, () => {
                cloth.spawn(c, cx, cy);
              });
            }
          }
        } else if (action.kind === 'CHOP') {
          // CHOP: actor stays in PULL pose briefly (still grabbing the
          // pants-down victim) before STRIKE; victim already shows SHAME
          // because pantsDown persists from prior round.
          actor.setState('PULL');
          victim.setState('SHAME');
          // §K3 cinematic zoom IN: same triplet as PULL_PANTS but
          // focal on the target's house door (~96px above the victim's
          // feet line — house anchor is center-bottom). When the blade
          // bites at STRIKE the splinters bloom at scale.
          const houseDoorX = victim.view.x;
          const houseDoorY = victim.view.y - 96;
          this.scene.camera?.zoomTo(
            houseDoorX,
            houseDoorY,
            ZOOM_PEAK,
            ZOOM_IN_MS,
            'out',
          );
        }
      });

      // §K3 ZOOM-OUT beat: 1.6 → 1.0 over 400ms ease-in. Fires after
      // the 600ms zoom-in + 800ms hold (= shame frame), regardless of
      // PULL_PANTS vs CHOP — both share the same triplet timing.
      scheduleAt(this.timers, t0, atZoomOut, () => {
        // Recenter on stage middle for the pull-back. Use the midpoint
        // between actor's home and the target as a sane neutral point.
        const recenterX = (actorHomeX + victimX) / 2;
        const recenterY = victim.view.y - 48;
        this.scene.camera?.zoomTo(
          recenterX,
          recenterY,
          1.0,
          ZOOM_OUT_MS,
          'in-out',
        );
      });

      // STRIKE: actor swings the knife. For PULL_PANTS rounds this is
      // the wind-up flourish over the just-revealed briefs; for CHOP
      // rounds the blade connects (engine's SET_STAGE→DEAD already
      // fires at this offset in the effect list, which we ignore on
      // canvas — we use it only via the post-action snapshot).
      scheduleAt(this.timers, t0, atStrike, () => {
        actor.setState('STRIKE');
        // Subtle Y-biased thump on every STRIKE (FINAL_GOAL §C4:
        // amp 8 px, 80 ms). Reads as the punch downbeat regardless
        // of whether the strike connects or just flourishes.
        this.scene.camera?.shake({ amp: 8, ms: 80, axis: 'y' });
        if (action.kind === 'CHOP') {
          // Sharp metallic chop on contact + low thud follow-up at the
          // IMPACT phase boundary so the house-damage hit registers
          // physically as well as metallically.
          playSfx('chop');
          window.setTimeout(() => playSfx('thud'), 600);
          // Wood chips: 14 chips (≥ 12 spec) emanating from the victim
          // body at strike point, with a second smaller follow-up burst
          // 200ms later as the blade bites a second time.
          const chips = this.scene.woodChips;
          if (chips) {
            const cx = victim.view.x;
            const cy = victim.view.y - 50;
            chips.spawn(14, cx, cy);
            scheduleAt(this.timers, t0, atStrike + 200, () => {
              chips.spawn(6, cx, cy);
            });
          }
          // KO shake (§C4: amp 16 px, 200 ms, X-biased recoil) — fires
          // on CHOP rounds at IMPACT (atStrike + STRIKE_DURATION=600).
          // The shake superposes on the lingering STRIKE shake, so the
          // viewer feels the hit land twice: the swing thump, then the
          // larger follow-through as the victim crumples.
          scheduleAt(this.timers, t0, atStrike + 600, () => {
            this.scene.camera?.shake({ amp: 16, ms: 200, axis: 'x' });
          });
        }
      });

      // IMPACT: actor relaxes to IDLE but STAYS at the target's house
      // through the end of the round (FINAL_GOAL §K2 — RETURN beat
      // dropped). The §K3 zoom-out triplet has already pulled the
      // camera back to neutral 1.0 by atZoomOut+ZOOM_OUT_MS=4200, so
      // we don't re-issue a zoom here. The actor's teleport home
      // happens via reset() before the next round's PREP.
      scheduleAt(this.timers, t0, atImpact, () => {
        actor.setState('IDLE');
      });

      // After the slide completes, lock pants-down so the briefs
      // persist across rounds (FINAL_GOAL §C7). This complements the
      // post-action snapshot reconcile in GameStage.
      if (action.kind === 'PULL_PANTS') {
        scheduleAt(this.timers, t0, atPullPants + PHASE_T_PULL_PANTS, () => {
          victim.setPantsDown(true);
        });
      }
    }

    // Victory confetti — if this round produced a GAME_OVER, kick off
    // the celebration just before the action timeline ends so confetti
    // is already swirling when Game.tsx flips to the result screen.
    const gameOver = effects.find((e) => e.type === 'GAME_OVER');
    if (gameOver) {
      const confetti = this.scene.confetti;
      if (confetti) {
        const vp = this.scene.getViewportSize?.() ?? { width: 800, height: 600 };
        const cx = vp.width / 2;
        const cy = vp.height * 0.18;
        // 32 + 32 = ≥ 32 spec, two staggered bursts so confetti keeps
        // arriving as the first wave starts to fall.
        scheduleAt(this.timers, t0, ROUND_TOTAL_MS - 600, () => {
          confetti.spawn(32, cx, cy);
        });
        scheduleAt(this.timers, t0, ROUND_TOTAL_MS - 200, () => {
          confetti.spawn(32, cx, cy);
        });
      }
    }

    await waitMs(ROUND_TOTAL_MS);
    this.scene.revealGlyphs?.hide();
    this.active = false;
  }
}

/** Resolve after `ms` milliseconds via setTimeout. */
function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
