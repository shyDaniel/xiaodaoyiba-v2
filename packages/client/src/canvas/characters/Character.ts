// Character — a chibi-style fighter holding a knife. Drawn entirely with
// PixiJS Graphics (no external sprite assets) so the bring-up works on any
// clean install. Composition:
//
//   head (skin) + hair cap + eyes + mouth + cheek blush
//   body (shirt with arm-shadow accent + collar)
//   arms (skin) + knife in active hand
//   legs (red briefs underneath, top-pants on top — top-pants is its own
//     transformable layer that slides waist→ankle during PULL_PANTS, then
//     stays at the ankle / hidden while ALIVE_PANTS_DOWN persists across
//     rounds — FINAL_GOAL §C7)
//   feet (boots)
//   shadow ellipse on the ground
//
// State machine surfaces simple high-level methods (idle/rush/strike/dead)
// which set internal targets the update() loop interpolates toward, so the
// visible state holds for ≥ 500ms (no flash-by). High-level animation
// dispatch is owned by EffectPlayer.ts (consumes Effect[] from the engine
// and calls the methods below at the right phase boundaries).

import { Container, Graphics } from 'pixi.js';
import { palette, playerColor } from '../../palette.js';

export type CharacterState =
  | 'IDLE'
  | 'PREP'
  | 'RUSH'
  | 'STRIKE'
  | 'PULL'
  | 'SHAME'
  | 'DEAD'
  | 'CHEER';

export interface CharacterOptions {
  id: string;
  nickname: string;
  /** Which way the character faces by default (`1` = right). */
  facing: 1 | -1;
  /** Visual scale multiplier — 1.0 ≈ 128px. */
  scale?: number;
}

/** Top-pants y0 (waist line) and y1 (ankle line) in character-local units.
 *  Briefs occupy y ∈ [-36, -20]. With y=0 the top-pants sits over the briefs;
 *  with y=TOP_PANTS_Y_ANKLE (~30) the top-pants is bunched at the ankle so
 *  the briefs read above it. */
const TOP_PANTS_Y_WAIST = 0;
const TOP_PANTS_Y_ANKLE = 30;

export class Character {
  readonly view: Container;
  readonly id: string;
  readonly nickname: string;
  facing: 1 | -1;

  /** Logical x on the gameplay layer the character returns to between
   *  actions. Set by GameStage via `setHomeX()`. */
  private homeX = 0;

  private readonly body: Container;
  private readonly head: Graphics;
  private readonly hair: Graphics;
  private readonly torso: Graphics;
  private readonly armBack: Graphics;
  private readonly armFront: Graphics;
  private readonly knife: Graphics;
  /** Briefs underlayer — drawn first (always present in the rig but the
   *  topPants on top hides them visually until PULL slides them away). */
  private readonly briefs: Graphics;
  /** Top-pants layer that slides waist→ankle during PULL_PANTS and stays
   *  hidden once `pantsDown===true`. */
  private readonly topPants: Graphics;
  private readonly feet: Graphics;
  private readonly shadow: Graphics;
  private readonly mouth: Graphics;
  private readonly leftEye: Graphics;
  private readonly rightEye: Graphics;
  private readonly sweat: Graphics;

  private state: CharacterState = 'IDLE';
  private elapsed = 0;
  private knifeBaseRot = 0;
  /** Persistent pants-down flag (FINAL_GOAL §C7). Once true, briefs are
   *  visible and topPants hidden every subsequent frame. */
  private pantsDown = false;
  /** Active top-pants tween (waist→ankle slide during PULL_PANTS). */
  private pantsTween: { from: number; to: number; start: number; durMs: number } | null = null;
  /** Active x-translate tween (RUSH / RETURN). */
  private moveTween:
    | { fromX: number; toX: number; start: number; durMs: number; ease: 'in-out' | 'out'; resolve: () => void }
    | null = null;

  constructor(opts: CharacterOptions) {
    this.id = opts.id;
    this.nickname = opts.nickname;
    this.facing = opts.facing;

    const scale = opts.scale ?? 1;

    this.view = new Container();
    this.view.scale.set(scale * (opts.facing === 1 ? 1 : -1), scale);

    this.shadow = new Graphics();
    this.body = new Container();
    this.briefs = new Graphics();
    this.topPants = new Graphics();
    this.feet = new Graphics();
    this.armBack = new Graphics();
    this.torso = new Graphics();
    this.armFront = new Graphics();
    this.knife = new Graphics();
    this.head = new Graphics();
    this.hair = new Graphics();
    this.mouth = new Graphics();
    this.leftEye = new Graphics();
    this.rightEye = new Graphics();
    this.sweat = new Graphics();
    this.sweat.visible = false;

    // Z-order: briefs first (underlayer, always drawn), then topPants on
    // top of them — when topPants slides down, the briefs read.
    this.view.addChild(this.shadow);
    this.view.addChild(this.body);
    this.body.addChild(this.armBack);
    this.body.addChild(this.briefs);
    this.body.addChild(this.topPants);
    this.body.addChild(this.feet);
    this.body.addChild(this.torso);
    this.body.addChild(this.head);
    this.body.addChild(this.hair);
    this.body.addChild(this.leftEye);
    this.body.addChild(this.rightEye);
    this.body.addChild(this.mouth);
    this.body.addChild(this.armFront);
    this.body.addChild(this.knife);
    this.body.addChild(this.sweat);

    this.draw();
    // Start with top-pants at waist (covering briefs).
    this.topPants.y = TOP_PANTS_Y_WAIST;
  }

  setState(state: CharacterState): void {
    this.state = state;
    if (state === 'SHAME') {
      this.pantsDown = true;
      this.sweat.visible = true;
    }
    if (state === 'DEAD') {
      this.view.alpha = 0.5;
      this.view.rotation = 0.5;
    }
    if (state === 'IDLE') {
      this.body.rotation = 0;
      this.armFront.rotation = 0;
      this.armFront.y = 0;
    }
  }

  getState(): CharacterState {
    return this.state;
  }

  /** Manually mark/unmark pants-down (used for engine-snapshot reconcile
   *  and across-round persistence). When true, top-pants is hidden and
   *  briefs read; when false, the top-pants is restored at the waist.
   *  Idempotent. */
  setPantsDown(v: boolean): void {
    this.pantsDown = v;
    if (v) {
      this.topPants.visible = false;
      this.topPants.y = TOP_PANTS_Y_ANKLE;
    } else {
      this.topPants.visible = true;
      this.topPants.y = TOP_PANTS_Y_WAIST;
    }
  }

  isPantsDown(): boolean {
    return this.pantsDown;
  }

  /** Set the character's home x (the position they idle at and return to).
   *  Stored separately from view.x so RETURN tweens know where to go. */
  setHomeX(x: number): void {
    this.homeX = x;
  }

  getHomeX(): number {
    return this.homeX;
  }

  /** World-space x of the character (post any active move tween step). */
  getCenterX(): number {
    return this.view.x;
  }

  /** Tween view.x to targetX over durMs. `ease`:
   *   - 'out' for the rush (decelerates into the victim — punchy)
   *   - 'in-out' for the return (smoothstep both ends)
   *  Resolves when the tween completes (or when interrupted by another
   *  `moveTo`). Awaiting is optional — the tween advances every frame
   *  via update(). */
  moveTo(targetX: number, durMs: number, ease: 'in-out' | 'out' = 'out'): Promise<void> {
    return new Promise((resolve) => {
      // If a previous tween is still pending, resolve it before replacing
      // — callers awaiting it should not block the next phase.
      if (this.moveTween) this.moveTween.resolve();
      this.moveTween = {
        fromX: this.view.x,
        toX: targetX,
        start: performance.now(),
        durMs: Math.max(1, durMs),
        ease,
        resolve,
      };
    });
  }

  /** Slide the top-pants from current y to the ankle line over `durMs`,
   *  revealing the red briefs progressively. Triggered for the *victim*
   *  during PULL_PANTS. After the slide completes, the EffectPlayer
   *  should call `setPantsDown(true)` to make the state persistent. */
  slideTopPantsDown(durMs: number): void {
    this.topPants.visible = true;
    this.pantsTween = {
      from: this.topPants.y,
      to: TOP_PANTS_Y_ANKLE,
      start: performance.now(),
      durMs: Math.max(1, durMs),
    };
  }

  update(dtMs: number): void {
    this.elapsed += dtMs;
    if (this.state === 'DEAD') {
      // Still advance any in-flight move tween (so corpses don't freeze in
      // mid-air on the return path) — but skip the idle/state choreography.
      this.advanceMoveTween();
      this.advancePantsTween();
      return;
    }

    // Idle bob
    const t = this.elapsed / 1000;
    const bob = Math.sin(t * 4) * 1.2;
    this.body.y = bob;

    // Default arm pose
    this.armFront.rotation = 0;
    this.armFront.y = 0;
    this.knife.rotation = this.knifeBaseRot + Math.sin(t * 3.2) * 0.08;
    this.body.rotation = 0;

    if (this.state === 'PREP') {
      // crouch + raise knife (anticipation)
      this.body.y = bob - 2;
      this.body.rotation = -0.04;
      this.knife.rotation = this.knifeBaseRot - 0.6;
    } else if (this.state === 'RUSH') {
      // hard lean forward + arm + knife raised high — the title verb 冲
      const stride = Math.sin(t * 18);
      this.body.rotation = 0.22 + stride * 0.04;
      this.body.y = bob + 1 + Math.abs(stride) * 1.5;
      this.armFront.rotation = -0.9 + stride * 0.2;
      this.knife.rotation = this.knifeBaseRot - 1.0;
    } else if (this.state === 'STRIKE') {
      // chopping arc — fast sin-driven swing of arm + knife
      const arc = Math.sin(t * 22);
      this.armFront.rotation = -0.6 + arc * 0.7;
      this.knife.rotation = this.knifeBaseRot - 0.8 + arc * 1.4;
      this.body.rotation = 0.06 + arc * 0.05;
    } else if (this.state === 'PULL') {
      // grab forward — arm extended, slight crouch
      const pull = Math.sin(t * 12);
      this.body.rotation = 0.1;
      this.body.y = bob - 1;
      this.armFront.rotation = -1.2 + pull * 0.15;
      this.armFront.y = -2;
      this.knife.rotation = this.knifeBaseRot + 0.3;
    } else if (this.state === 'CHEER') {
      this.armFront.rotation = Math.sin(t * 8) * 0.4 - 0.4;
      this.knife.rotation = this.knifeBaseRot - 0.3 + Math.sin(t * 8) * 0.3;
    } else if (this.state === 'SHAME') {
      // hunched shoulders, slight quiver
      this.body.rotation = -0.05 + Math.sin(t * 14) * 0.02;
      this.armFront.rotation = 0.4;
    }

    // Sweat in shame / pants-down
    if (this.state === 'SHAME' || this.pantsDown) {
      this.sweat.visible = true;
      this.sweat.alpha = 0.5 + Math.sin(t * 6) * 0.5;
    } else {
      this.sweat.visible = false;
    }

    this.advanceMoveTween();
    this.advancePantsTween();
  }

  /** Synchronous one-step advance of the active x tween. */
  private advanceMoveTween(): void {
    const tw = this.moveTween;
    if (!tw) return;
    const elapsed = performance.now() - tw.start;
    const k = Math.min(1, elapsed / tw.durMs);
    const eased = tw.ease === 'in-out'
      ? // smoothstep
        k * k * (3 - 2 * k)
      : // ease-out (decelerating) — punchier rush
        1 - Math.pow(1 - k, 2);
    this.view.x = tw.fromX + (tw.toX - tw.fromX) * eased;
    if (k >= 1) {
      this.moveTween = null;
      tw.resolve();
    }
  }

  /** Synchronous one-step advance of the active top-pants slide tween. */
  private advancePantsTween(): void {
    const tw = this.pantsTween;
    if (!tw) return;
    const elapsed = performance.now() - tw.start;
    const k = Math.min(1, elapsed / tw.durMs);
    // ease-in: pants resist briefly then drop fast (gravity feel)
    const eased = k * k;
    this.topPants.y = tw.from + (tw.to - tw.from) * eased;
    if (k >= 1) this.pantsTween = null;
  }

  private draw(): void {
    // ===== shadow =====
    this.shadow.ellipse(0, 4, 38, 8).fill({ color: 0x000000, alpha: 0.35 });

    // Coordinate system: feet at y=0, head at y=-128.
    const tint = playerColor(this.id);
    const tintShadow = darken(tint, 0.5);

    // ===== red briefs (always drawn; top-pants on top hides them) =====
    const b = this.briefs;
    b.rect(-20, -36, 40, 16).fill({ color: palette.briefs });
    b.rect(-20, -36, 40, 4).fill({ color: palette.briefsShadow });
    // leg openings
    b.rect(-20, -22, 14, 2).fill({ color: palette.briefsShadow });
    b.rect(6, -22, 14, 2).fill({ color: palette.briefsShadow });
    // a tiny heart for personality
    b.poly([0, -28, -4, -32, -2, -34, 0, -32, 2, -34, 4, -32]).fill({ color: 0xfff0f0 });

    // ===== top-pants (slides waist → ankle on PULL_PANTS) =====
    // The pants block + cuffs are drawn relative to (0, 0) at the *waist*
    // of the character; topPants.y=0 means waist-aligned (covers briefs);
    // topPants.y=TOP_PANTS_Y_ANKLE (~30) drops the entire block so the
    // briefs read above and the pants bunch around the ankles.
    const tp = this.topPants;
    // pant legs
    tp.rect(-18, -34, 14, 34).fill({ color: palette.pants });
    tp.rect(4, -34, 14, 34).fill({ color: palette.pants });
    // waist stitching
    tp.rect(-18, -34, 14, 4).fill({ color: 0x5a5a6a });
    tp.rect(4, -34, 14, 4).fill({ color: 0x5a5a6a });
    // belt buckle echo so the slide reads visually
    tp.rect(-2, -36, 6, 4).fill({ color: 0x282838 });

    // ===== feet (boots) =====
    this.feet.rect(-22, -4, 18, 6).fill({ color: 0x1a0e08 });
    this.feet.rect(4, -4, 18, 6).fill({ color: 0x1a0e08 });
    this.feet.rect(-22, 0, 18, 2).fill({ color: 0x000000 });
    this.feet.rect(4, 0, 18, 2).fill({ color: 0x000000 });

    // ===== torso (shirt) =====
    const tt = this.torso;
    // shirt back-shadow
    tt.rect(-22, -78, 44, 44).fill({ color: tintShadow });
    // shirt front
    tt.rect(-20, -78, 40, 44).fill({ color: tint });
    // belt
    tt.rect(-22, -36, 44, 4).fill({ color: 0x2a1a10 });
    tt.rect(-2, -36, 6, 4).fill({ color: palette.uiGold }); // buckle
    // collar V
    tt.poly([-8, -78, 8, -78, 0, -68]).fill({ color: tintShadow });
    tt.poly([-6, -78, 6, -78, 0, -70]).fill({ color: palette.skin });

    // ===== arms =====
    // back arm (subtle, behind torso)
    this.armBack.rect(-26, -74, 8, 28).fill({ color: tintShadow });
    this.armBack.rect(-28, -50, 12, 12).fill({ color: palette.skin });
    // front arm (with knife — pivots from shoulder)
    const af = this.armFront;
    af.position.set(20, -72);
    af.rect(-2, 0, 8, 30).fill({ color: tint });
    af.rect(-2, 0, 8, 6).fill({ color: tintShadow });
    af.rect(-4, 28, 12, 12).fill({ color: palette.skin });
    af.rect(-4, 28, 12, 4).fill({ color: palette.skinShadow });

    // ===== knife in front hand =====
    const k = this.knife;
    k.position.set(28, -36); // approximate hand grip
    this.knifeBaseRot = -0.35;
    k.rotation = this.knifeBaseRot;
    // handle
    k.rect(-3, 0, 6, 16).fill({ color: palette.knifeHandle });
    k.rect(-4, 14, 8, 4).fill({ color: 0x2a1a10 });
    // guard
    k.rect(-7, -2, 14, 4).fill({ color: 0x6a4a28 });
    // blade
    k.poly([-4, -2, 4, -2, 6, -28, 0, -36, -6, -28]).fill({ color: palette.knifeBlade });
    // edge highlight
    k.poly([-3, -2, -2, -2, 0, -34]).fill({ color: palette.knifeEdge });
    // shine streak
    k.poly([2, -10, 4, -10, 4, -22, 2, -22]).fill({ color: 0xffffff, alpha: 0.6 });

    // ===== head =====
    const h = this.head;
    // skin shadow back
    h.rect(-20, -118, 40, 38).fill({ color: palette.skinShadow });
    // skin front
    h.rect(-18, -118, 36, 36).fill({ color: palette.skin });
    // chin shadow
    h.rect(-18, -84, 36, 2).fill({ color: palette.skinShadow });
    // ears
    h.rect(-22, -104, 4, 10).fill({ color: palette.skin });
    h.rect(18, -104, 4, 10).fill({ color: palette.skin });
    h.rect(-21, -101, 2, 4).fill({ color: palette.skinShadow });
    h.rect(19, -101, 2, 4).fill({ color: palette.skinShadow });
    // cheek blush
    h.rect(-14, -94, 6, 4).fill({ color: 0xe89090, alpha: 0.7 });
    h.rect(8, -94, 6, 4).fill({ color: 0xe89090, alpha: 0.7 });

    // ===== hair cap =====
    const hr = this.hair;
    hr.rect(-22, -128, 44, 16).fill({ color: palette.hair });
    hr.rect(-22, -118, 6, 8).fill({ color: palette.hair }); // sideburn left
    hr.rect(16, -118, 6, 8).fill({ color: palette.hair });
    // crown sweep
    hr.poly([-22, -128, 22, -128, 14, -134, -14, -134]).fill({ color: palette.hair });

    // ===== eyes =====
    this.leftEye.rect(-12, -106, 6, 6).fill({ color: 0xffffff });
    this.leftEye.rect(-10, -104, 3, 3).fill({ color: 0x101018 });
    this.rightEye.rect(6, -106, 6, 6).fill({ color: 0xffffff });
    this.rightEye.rect(7, -104, 3, 3).fill({ color: 0x101018 });
    // brow
    this.leftEye.rect(-13, -110, 8, 2).fill({ color: palette.hair });
    this.rightEye.rect(5, -110, 8, 2).fill({ color: palette.hair });

    // ===== mouth =====
    this.mouth.rect(-4, -94, 8, 2).fill({ color: 0x4a2818 });

    // ===== sweat drop (shame) =====
    this.sweat
      .poly([0, -100, -4, -94, 4, -94])
      .fill({ color: 0x80c8e0 });
    this.sweat.position.set(20, -10);
    this.sweat.alpha = 0;
  }
}

function darken(hex: number, amount: number): number {
  const r = Math.max(0, Math.round(((hex >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((hex >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((hex & 0xff) * (1 - amount)));
  return (r << 16) | (g << 8) | b;
}
