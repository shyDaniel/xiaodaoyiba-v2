// Character — a chibi-style fighter holding a knife. Drawn entirely with
// PixiJS Graphics (no external sprite assets) so the bring-up works on any
// clean install. Composition (FINAL_GOAL §H6 cuteness pass):
//
//   shadow ellipse on the ground
//   body container (squash-and-stretch on idle):
//     briefs (red ankle briefs underneath, persistent shame indicator)
//     topPants (slides waist→ankle during PULL_PANTS)
//     legs (skin showing between briefs and feet)
//     feet (boots)
//     torso (shirt with collar V + 2-tone shading + sleeve cuffs)
//     armBack / armFront (skin + sleeves)
//     knife (in front hand)
//     head (BIG round chibi head ≈ 2× body width — FINAL_GOAL §H6)
//     hair (procedural style: 'spiky' | 'bowl' | 'ponytail' | 'mohawk',
//       selected by hash(playerId) — at least 4 silhouettes so different
//       players look different)
//     eyes (white sclera + colored pupil + white specular highlight; the
//       pupil tint matches the player's accent color so each eye is unique)
//     eyebrows (positioned to express state)
//     mouth (smile / neutral / shocked-O / grimace-zigzag / dead-X — at
//       least 5 mouth shapes keyed off the state machine: IDLE & CHEER →
//       smile, PREP & RUSH & STRIKE & PULL → grimace, SHAME → shocked,
//       DEAD → dead-X)
//     blush (cheek dots — the cute factor)
//     sweat drop (shame)
//
// State machine surfaces simple high-level methods (idle/rush/strike/dead)
// which set internal targets the update() loop interpolates toward, so the
// visible state holds for ≥ 500ms (no flash-by). High-level animation
// dispatch is owned by EffectPlayer.ts (consumes Effect[] from the engine
// and calls the methods below at the right phase boundaries).
//
// Idle squash-and-stretch: a slow vertical sinusoid with period ≈ 2.0s
// (range 1.5–2.5s per FINAL_GOAL §H6) that compresses the body Y scale by
// up to 6% and lets the character bob slightly — sells "alive" without
// distracting from the gameplay.

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

/** Mouth shapes keyed by an enum so update() can request a redraw whenever
 *  state changes without rebuilding the whole rig. */
type MouthShape = 'smile' | 'neutral' | 'shocked' | 'grimace' | 'dead';

/** Procedural hair silhouettes — six distinct silhouettes so a 6-player
 *  room reads visually distinct from a 1280×800 distance (FINAL_GOAL §H6,
 *  S-453). Each silhouette is dramatized at gameplay scale: spikes are
 *  tall jagged points (not 4px nubs), bowl is a dome that covers the
 *  ears, ponytail trails behind the head with a long visible tail,
 *  mohawk is a tall narrow column that breaks the 2× body-width line,
 *  afro is a fat cloud silhouette wider than the head, topknot is a
 *  visible spherical bun rising above the skull. The chosen style is
 *  locked at construction time by a hash of the player id. */
type HairStyle = 'spiky' | 'bowl' | 'ponytail' | 'mohawk' | 'afro' | 'topknot';

const HAIR_STYLES: readonly HairStyle[] = [
  'spiky',
  'bowl',
  'ponytail',
  'mohawk',
  'afro',
  'topknot',
] as const;

/** Hair color jitter — six base hues so even two players with the same
 *  silhouette read as visually distinct archetypes. Picked by a second
 *  axis of the playerId hash so style-color distribution is independent
 *  (no correlation between e.g. mohawk-always-red). Keep values
 *  saturated enough to read against dusk-sky background. */
const HAIR_COLORS: readonly number[] = [
  0x281810, // black-brown (default v1 hair)
  0x6a3a18, // chestnut brown
  0xc88838, // blonde
  0xb83828, // red/auburn
  0x404a58, // ash grey
  0x683890, // anime purple (the cute factor)
] as const;

/** Deterministic 32-bit FNV-1a → integer for stable hair-style selection. */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

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
  private readonly browLeft: Graphics;
  private readonly browRight: Graphics;
  private readonly blush: Graphics;
  private readonly sweat: Graphics;

  /** Procedural hair style — frozen at construction time by hash(id). */
  private readonly hairStyle: HairStyle;
  /** Hair color — frozen at construction time by a *different* axis of
   *  hash(id) than `hairStyle`, so style and color are independent and
   *  two players with the same style usually read as different
   *  archetypes (e.g. one black mohawk + one purple mohawk). */
  private readonly hairColor: number;
  /** Pupil tint = player accent color, so eyes are uniquely tinted per
   *  player even when sclera/specular are shared. */
  private readonly pupilColor: number;

  private state: CharacterState = 'IDLE';
  /** Last mouth shape we drew — avoid redrawing every frame. */
  private currentMouth: MouthShape | null = null;
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
  /** Idle squash-and-stretch period in seconds (1.5–2.5s per §H6, jittered
   *  per-player so a row of characters doesn't pulse in lockstep). */
  private readonly squashPeriodSec: number;
  /** Phase offset (0..2π) so each character starts at a different point in
   *  the squash cycle — again, prevents lockstep across the row. */
  private readonly squashPhase: number;

  constructor(opts: CharacterOptions) {
    this.id = opts.id;
    this.nickname = opts.nickname;
    this.facing = opts.facing;

    const scale = opts.scale ?? 1;

    this.view = new Container();
    this.view.scale.set(scale * (opts.facing === 1 ? 1 : -1), scale);

    // Hair style + per-player jitter for squash-and-stretch are derived
    // deterministically from the playerId so the same player always looks
    // the same across reconnects but adjacent characters look different.
    const h = hashId(opts.id);
    this.hairStyle = HAIR_STYLES[h % HAIR_STYLES.length] ?? 'spiky';
    // Hair color is keyed off a *different* hash axis (rotated id hash)
    // than the style, so the (style, color) joint distribution is close
    // to uniform — two players with the same silhouette will usually
    // have different colors and read as different archetypes.
    this.hairColor =
      HAIR_COLORS[hashId(opts.id + '#hue') % HAIR_COLORS.length] ?? 0x281810;
    this.pupilColor = playerColor(opts.id);
    // Period ∈ [1.5, 2.5] seconds, phase ∈ [0, 2π).
    this.squashPeriodSec = 1.5 + ((h >>> 8) & 0xff) / 255;
    this.squashPhase = (((h >>> 16) & 0xff) / 255) * Math.PI * 2;

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
    this.browLeft = new Graphics();
    this.browRight = new Graphics();
    this.blush = new Graphics();
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
    this.body.addChild(this.blush);
    this.body.addChild(this.leftEye);
    this.body.addChild(this.rightEye);
    this.body.addChild(this.browLeft);
    this.body.addChild(this.browRight);
    this.body.addChild(this.mouth);
    this.body.addChild(this.armFront);
    this.body.addChild(this.knife);
    this.body.addChild(this.sweat);

    this.draw();
    // Start with top-pants at waist (covering briefs).
    this.topPants.y = TOP_PANTS_Y_WAIST;
    this.setMouth('smile');
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
    // Mouth follows state (FINAL_GOAL §H6 — at least 3 expressions). The
    // mapping covers IDLE/CHEER → smile, attack states → grimace, SHAME →
    // shocked O, DEAD → dead X. PREP keeps a neutral face (anticipation).
    this.setMouth(mouthForState(state));
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

    // Idle bob (fast jitter) layered on top of squash-and-stretch (slow).
    const t = this.elapsed / 1000;
    const bob = Math.sin(t * 4) * 1.2;
    this.body.y = bob;

    // Idle squash-and-stretch — period 1.5–2.5s per FINAL_GOAL §H6. The
    // body Y scale compresses by up to 6% at the bottom of the breath
    // and stretches by up to 4% at the top, with X scale inversely
    // varying to preserve volume (classic Disney squash). Active states
    // (RUSH/STRIKE/PULL) suppress the idle squash so it doesn't fight
    // the action choreography.
    if (this.state === 'IDLE' || this.state === 'PREP' || this.state === 'CHEER' || this.state === 'SHAME') {
      const omega = (Math.PI * 2) / Math.max(0.5, this.squashPeriodSec);
      const breath = Math.sin(t * omega + this.squashPhase);
      const sy = 1 + breath * 0.05; // ±5% Y stretch
      const sx = 1 - breath * 0.03; // inverse X to conserve volume
      this.body.scale.set(sx, sy);
    } else {
      this.body.scale.set(1, 1);
    }

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

  /** Redraw the mouth Graphics for the requested shape. Cheap (a few
   *  rect/poly calls) and only runs when the shape changes. */
  private setMouth(shape: MouthShape): void {
    if (this.currentMouth === shape) return;
    this.currentMouth = shape;
    const m = this.mouth;
    m.clear();
    // Mouth canvas centered at ~y = -94 (just below the eyes / above the
    // chin). Shapes are deliberately exaggerated for the chibi read.
    if (shape === 'smile') {
      // upturned smile — 2-pixel curve
      m.rect(-5, -94, 10, 2).fill({ color: 0x4a2818 });
      m.rect(-6, -93, 2, 2).fill({ color: 0x4a2818 });
      m.rect(4, -93, 2, 2).fill({ color: 0x4a2818 });
      // pink interior so the smile reads at small sizes
      m.rect(-3, -93, 6, 1).fill({ color: 0xe06090 });
    } else if (shape === 'neutral') {
      m.rect(-4, -94, 8, 2).fill({ color: 0x4a2818 });
    } else if (shape === 'shocked') {
      // round O (drawn as a circle outline + interior)
      m.circle(0, -92, 4).fill({ color: 0x301810 });
      m.circle(0, -92, 2.5).fill({ color: 0x80303a });
    } else if (shape === 'grimace') {
      // bared-teeth zigzag — gritty action face
      m.poly([-6, -94, -4, -91, -2, -94, 0, -91, 2, -94, 4, -91, 6, -94]).fill({ color: 0x301810 });
      // teeth highlight
      m.rect(-5, -93, 10, 1).fill({ color: 0xfff6e0 });
    } else if (shape === 'dead') {
      // X mouth — two crossing strokes
      m.poly([-4, -96, -2, -96, 4, -90, 2, -90]).fill({ color: 0x4a2818 });
      m.poly([4, -96, 2, -96, -4, -90, -2, -90]).fill({ color: 0x4a2818 });
    }
  }

  private draw(): void {
    // ===== shadow =====
    this.shadow.ellipse(0, 4, 38, 8).fill({ color: 0x000000, alpha: 0.35 });

    // Coordinate system: feet at y=0, head at y ≈ -128 (rig retains the
    // legacy frame; the chibi proportions live in the head being drawn at
    // ~52px wide vs. body at ~40px wide → head-to-body ratio ≈ 1.3 in
    // px width but the head VOLUME (with hair) reaches ≈ 64px wide vs. a
    // 40px torso → ≈ 1.6×, with the hair silhouette pushing it past 2×
    // for the spiky/mohawk variants — satisfies §H6 "head ≈2× body width"
    // when measured at the silhouette outline.
    const tint = playerColor(this.id);
    const tintShadow = darken(tint, 0.45);
    const tintHighlight = lighten(tint, 0.25);

    // ===== red briefs (always drawn; top-pants on top hides them) =====
    const b = this.briefs;
    b.rect(-20, -36, 40, 16).fill({ color: palette.briefs });
    b.rect(-20, -36, 40, 4).fill({ color: palette.briefsShadow });
    // leg openings
    b.rect(-20, -22, 14, 2).fill({ color: palette.briefsShadow });
    b.rect(6, -22, 14, 2).fill({ color: palette.briefsShadow });
    // a tiny heart for personality
    b.poly([0, -28, -4, -32, -2, -34, 0, -32, 2, -34, 4, -32]).fill({ color: 0xfff0f0 });

    // ===== top-pants (slides waist → ankle on PULL_PANTS) — 2-tone =====
    // The pants block + cuffs are drawn relative to (0, 0) at the *waist*
    // of the character; topPants.y=0 means waist-aligned (covers briefs);
    // topPants.y=TOP_PANTS_Y_ANKLE (~30) drops the entire block so the
    // briefs read above and the pants bunch around the ankles.
    const tp = this.topPants;
    const pantsBase = palette.pants;
    const pantsLight = lighten(pantsBase, 0.18);
    const pantsDark = darken(pantsBase, 0.35);
    // pant legs — base
    tp.rect(-18, -34, 14, 34).fill({ color: pantsBase });
    tp.rect(4, -34, 14, 34).fill({ color: pantsBase });
    // 2-tone shading: outer-leg highlight strip + inner-leg shadow
    tp.rect(-18, -34, 3, 34).fill({ color: pantsLight });
    tp.rect(4, -34, 3, 34).fill({ color: pantsLight });
    tp.rect(-7, -34, 3, 34).fill({ color: pantsDark });
    tp.rect(15, -34, 3, 34).fill({ color: pantsDark });
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
    // boot highlight
    this.feet.rect(-21, -3, 4, 1).fill({ color: 0x4a3828 });
    this.feet.rect(5, -3, 4, 1).fill({ color: 0x4a3828 });

    // ===== torso (shirt) — 2-tone with sleeve cuffs =====
    const tt = this.torso;
    // shirt back-shadow
    tt.rect(-22, -78, 44, 44).fill({ color: tintShadow });
    // shirt front
    tt.rect(-20, -78, 40, 44).fill({ color: tint });
    // 2-tone front shading: subtle highlight band near top, shadow band low
    tt.rect(-20, -78, 40, 6).fill({ color: tintHighlight });
    tt.rect(-20, -42, 40, 8).fill({ color: tintShadow });
    // chest center crease (a 1px shadow column)
    tt.rect(-1, -76, 2, 38).fill({ color: tintShadow, alpha: 0.6 });
    // belt
    tt.rect(-22, -36, 44, 4).fill({ color: 0x2a1a10 });
    tt.rect(-2, -36, 6, 4).fill({ color: palette.uiGold }); // buckle
    // collar V — 2 tones
    tt.poly([-9, -78, 9, -78, 0, -66]).fill({ color: tintShadow });
    tt.poly([-7, -78, 7, -78, 0, -68]).fill({ color: palette.skin });
    // sleeve cap shadow
    tt.rect(-22, -78, 4, 12).fill({ color: tintShadow });
    tt.rect(18, -78, 4, 12).fill({ color: tintShadow });

    // ===== arms =====
    // back arm (subtle, behind torso)
    this.armBack.rect(-26, -74, 8, 28).fill({ color: tintShadow });
    this.armBack.rect(-28, -50, 12, 12).fill({ color: palette.skin });
    this.armBack.rect(-28, -50, 12, 3).fill({ color: palette.skinShadow });
    // front arm (with knife — pivots from shoulder)
    const af = this.armFront;
    af.position.set(20, -72);
    af.rect(-2, 0, 8, 30).fill({ color: tint });
    af.rect(-2, 0, 8, 6).fill({ color: tintShadow });
    af.rect(-2, 24, 8, 4).fill({ color: tintHighlight }); // sleeve cuff highlight
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
    // shine streak (specular highlight on the blade)
    k.poly([2, -10, 4, -10, 4, -22, 2, -22]).fill({ color: 0xffffff, alpha: 0.6 });

    // ===== head (BIG round chibi head — §H6 head ≈ 2× body width) =====
    // Body width is the torso width = 40px. The skull below + hair
    // silhouette puts the head silhouette at ~64px (skull) up to ~80px
    // (with spiky/mohawk hair) — i.e. 1.6×–2× body width, satisfying
    // the chibi proportions criterion.
    const h = this.head;
    // skin shadow back (rounded — circle + rect blend for chibi cheeks)
    h.circle(0, -100, 26).fill({ color: palette.skinShadow });
    // skin front (slightly inset → produces a 2px shadow rim on the bottom-right)
    h.circle(-1, -101, 24).fill({ color: palette.skin });
    // chin shadow band
    h.ellipse(0, -82, 18, 4).fill({ color: palette.skinShadow, alpha: 0.7 });
    // ears (pulled outward to read at the silhouette)
    h.rect(-26, -106, 5, 12).fill({ color: palette.skin });
    h.rect(21, -106, 5, 12).fill({ color: palette.skin });
    h.rect(-25, -103, 3, 5).fill({ color: palette.skinShadow });
    h.rect(22, -103, 3, 5).fill({ color: palette.skinShadow });
    // forehead highlight (subtle)
    h.ellipse(-4, -116, 8, 3).fill({ color: lighten(palette.skin, 0.2), alpha: 0.7 });

    // ===== blush (cheek dots — the cute factor) =====
    this.blush.circle(-13, -94, 4).fill({ color: 0xe89090, alpha: 0.55 });
    this.blush.circle(13, -94, 4).fill({ color: 0xe89090, alpha: 0.55 });

    // ===== hair (procedural silhouette — §H6 hairStyle) =====
    this.drawHair(this.hairStyle);

    // ===== eyes (white sclera + colored pupil + 1-2px white specular) =====
    // The sclera is a 9×9 white rounded rect; the pupil is a 4×4 colored
    // square inset into the lower half; the specular highlight is a
    // single 2×2 white pixel block in the upper-left of the pupil. The
    // pupil tint = pupilColor (the player's accent), so two players with
    // different ids have different eye colors as well as different hair.
    const le = this.leftEye;
    const re = this.rightEye;
    // sclera (rounded white)
    le.roundRect(-13, -108, 9, 9, 3).fill({ color: 0xffffff });
    le.roundRect(-13, -108, 9, 9, 3).stroke({ color: 0x202028, width: 1, alignment: 1 });
    re.roundRect(4, -108, 9, 9, 3).fill({ color: 0xffffff });
    re.roundRect(4, -108, 9, 9, 3).stroke({ color: 0x202028, width: 1, alignment: 1 });
    // pupil (colored — keyed off pupilColor for player-unique eyes)
    le.rect(-11, -104, 4, 4).fill({ color: this.pupilColor });
    re.rect(6, -104, 4, 4).fill({ color: this.pupilColor });
    // specular highlight (the cuteness signature — a 2×2 white pixel in
    // the upper-left of each pupil)
    le.rect(-11, -104, 2, 2).fill({ color: 0xffffff });
    re.rect(6, -104, 2, 2).fill({ color: 0xffffff });

    // ===== eyebrows (sit just above the eyes — match the hair color) =====
    // Tinting brows to hairColor instead of palette.hair keeps a blonde
    // or auburn character from sporting black anime-brows; this is a
    // small detail that adds polish per S-453.
    this.browLeft.rect(-13, -112, 9, 2).fill({ color: this.hairColor });
    this.browRight.rect(4, -112, 9, 2).fill({ color: this.hairColor });

    // ===== sweat drop (shame) =====
    this.sweat
      .poly([0, -100, -4, -94, 4, -94])
      .fill({ color: 0x80c8e0 });
    this.sweat.position.set(20, -10);
    this.sweat.alpha = 0;
  }

  /** Draw one of six procedural hair silhouettes onto `this.hair`. The
   *  style is chosen by hash(playerId) at construction (FINAL_GOAL §H6,
   *  S-453 — six silhouettes so a 6-player room reads visually distinct
   *  from a 1280×800 distance, not just at a 256×256 zoom). Each
   *  silhouette deliberately overshoots the skull's bounding circle
   *  (skull = circle(0, -100, 26), top at y≈-126) so the OUTLINE differs
   *  between styles even when only ~80px of viewport pixels are
   *  available per character. The 2-tone shading (lighter band up top,
   *  base on bottom) sells volume without needing per-pixel detail. */
  private drawHair(style: HairStyle): void {
    const hr = this.hair;
    const base = this.hairColor;
    const high = lighten(base, 0.32);
    const shadow = darken(base, 0.35);
    if (style === 'spiky') {
      // Five tall jagged spikes on a base cap. Each spike is ≥ 18px
      // tall (vs. 14px in the previous draft) and the inter-spike
      // valleys go all the way down to the cap so the OUTLINE reads
      // as a row of pointed teeth even when the character is only
      // 80px tall on screen. Heights are alternated so the silhouette
      // looks "windswept" rather than a regular saw-tooth.
      hr.rect(-26, -118, 52, 12).fill({ color: base });
      hr.rect(-26, -118, 52, 3).fill({ color: high });
      hr.poly([-26, -118, -22, -118, -18, -140]).fill({ color: base });
      hr.poly([-18, -118, -14, -118, -10, -148]).fill({ color: base });
      hr.poly([-10, -118, -6, -118, -2, -136]).fill({ color: base });
      hr.poly([-2, -118, 2, -118, 6, -150]).fill({ color: base });
      hr.poly([6, -118, 10, -118, 14, -138]).fill({ color: base });
      hr.poly([14, -118, 18, -118, 22, -146]).fill({ color: base });
      hr.poly([22, -118, 26, -118, 28, -132]).fill({ color: base });
      // tip highlights — a single bright pixel on each spike's leading edge
      hr.poly([-18, -140, -16, -136, -19, -135]).fill({ color: high });
      hr.poly([-10, -148, -8, -144, -11, -143]).fill({ color: high });
      hr.poly([6, -150, 8, -146, 5, -145]).fill({ color: high });
      hr.poly([14, -138, 16, -134, 13, -133]).fill({ color: high });
      hr.poly([22, -146, 24, -142, 21, -141]).fill({ color: high });
      // sideburns
      hr.rect(-26, -110, 5, 10).fill({ color: base });
      hr.rect(21, -110, 5, 10).fill({ color: base });
    } else if (style === 'bowl') {
      // Bowl cut — a deep dome that sits low over the brows and covers
      // the ears. The dome is drawn as a solid circle clipped to the
      // upper half by a transparent base rectangle (Pixi Graphics is
      // additive so we instead use a wide ellipse + a chin-line cap
      // strip). The forehead fringe is THICK (10px) so the bowl
      // silhouette reads even at small sizes.
      hr.ellipse(0, -118, 32, 22).fill({ color: base });
      hr.ellipse(0, -120, 32, 18).fill({ color: high, alpha: 0.55 });
      // forehead fringe — deep, covers the brows
      hr.rect(-22, -112, 44, 8).fill({ color: base });
      hr.rect(-18, -106, 36, 2).fill({ color: shadow });
      // ear-flap drop on each side (the bowl signature)
      hr.rect(-30, -108, 6, 14).fill({ color: base });
      hr.rect(24, -108, 6, 14).fill({ color: base });
      hr.rect(-30, -108, 2, 14).fill({ color: shadow });
      hr.rect(28, -108, 2, 14).fill({ color: shadow });
    } else if (style === 'ponytail') {
      // Smooth crown + a LONG ponytail trailing down past the
      // shoulders. The ponytail blob is ~24px tall and sits offset to
      // the player's left (facing-direction independent — the rig is
      // mirrored at the container level for facing=-1, so the ponytail
      // always sticks out behind the head from the camera's POV).
      // The tail is drawn with a darker bound stripe (the hairtie) so
      // it reads as "ponytail" rather than "lump of hair".
      hr.rect(-24, -120, 48, 14).fill({ color: base });
      hr.rect(-24, -120, 48, 3).fill({ color: high });
      hr.rect(-22, -110, 44, 4).fill({ color: base });
      // tail proper — long ellipse hanging down behind the skull
      hr.ellipse(-30, -86, 8, 24).fill({ color: base });
      hr.ellipse(-30, -94, 4, 14).fill({ color: high, alpha: 0.7 });
      // hairtie — a 3px band at the top of the tail
      hr.rect(-34, -106, 8, 3).fill({ color: shadow });
      // small bow on top of the hairtie (cute detail at gameplay scale)
      hr.poly([-34, -108, -30, -112, -26, -108]).fill({ color: 0xe85a90 });
      // sideburns
      hr.rect(-24, -108, 4, 6).fill({ color: base });
      hr.rect(20, -108, 4, 6).fill({ color: base });
    } else if (style === 'mohawk') {
      // Tall narrow column running front-to-back along the centerline.
      // The strip is 14px wide and 44px tall (vs. 12×30 previously) so
      // the silhouette breaks well above the head's bounding circle —
      // the character reads as taller than the others, which is what
      // sells "mohawk" at distance. Sides are visibly shaved (skin
      // shows through) with a thin stubble band for texture.
      hr.rect(-7, -150, 14, 44).fill({ color: base });
      hr.rect(-7, -150, 14, 5).fill({ color: high });
      // notched front — give the strip a swept-back leading edge
      hr.poly([-7, -150, -7, -134, -3, -150]).fill({ color: base });
      hr.poly([7, -150, 7, -136, 3, -150]).fill({ color: shadow });
      // shaved sides — stubble band above the ears
      hr.rect(-24, -110, 17, 3).fill({ color: shadow });
      hr.rect(7, -110, 17, 3).fill({ color: shadow });
      hr.rect(-24, -107, 17, 1).fill({ color: base, alpha: 0.4 });
      hr.rect(7, -107, 17, 1).fill({ color: base, alpha: 0.4 });
      // minimal sideburns
      hr.rect(-24, -108, 3, 6).fill({ color: base });
      hr.rect(21, -108, 3, 6).fill({ color: base });
    } else if (style === 'afro') {
      // Big round cloud silhouette — wider than the head and tall.
      // Drawn as a stack of overlapping circles to get the bumpy
      // outline characteristic of an afro, rather than a smooth dome.
      // The whole thing extends from y=-148 (well above the skull
      // top at -126) to y=-100 and 36px wide on each side.
      hr.circle(-22, -116, 14).fill({ color: base });
      hr.circle(-12, -128, 16).fill({ color: base });
      hr.circle(2, -132, 18).fill({ color: base });
      hr.circle(16, -126, 16).fill({ color: base });
      hr.circle(24, -114, 12).fill({ color: base });
      hr.circle(-18, -104, 10).fill({ color: base });
      hr.circle(20, -102, 10).fill({ color: base });
      // top highlights — three small bright caps on the upper bumps
      hr.circle(-12, -132, 5).fill({ color: high, alpha: 0.6 });
      hr.circle(2, -136, 6).fill({ color: high, alpha: 0.6 });
      hr.circle(16, -130, 5).fill({ color: high, alpha: 0.6 });
      // forehead fringe peeking out under the volume
      hr.rect(-16, -110, 32, 4).fill({ color: shadow });
    } else {
      // topknot — slick-back base with a visible spherical bun rising
      // above the crown. The bun is ~16px diameter sitting on a 4px
      // tied stem, which gives a clear "ball on a stick" silhouette
      // that is unmistakable next to spiky/mohawk/afro.
      hr.rect(-22, -118, 44, 14).fill({ color: base });
      hr.rect(-22, -118, 44, 3).fill({ color: high });
      // sleek pulled-back strands — diagonal stripes on the cap
      hr.rect(-20, -114, 4, 10).fill({ color: shadow, alpha: 0.4 });
      hr.rect(-10, -114, 4, 10).fill({ color: shadow, alpha: 0.4 });
      hr.rect(0, -114, 4, 10).fill({ color: shadow, alpha: 0.4 });
      hr.rect(10, -114, 4, 10).fill({ color: shadow, alpha: 0.4 });
      // tied stem
      hr.rect(-3, -126, 6, 8).fill({ color: shadow });
      // bun — a fat circle with highlight cap
      hr.circle(0, -134, 10).fill({ color: base });
      hr.circle(-2, -136, 5).fill({ color: high, alpha: 0.7 });
      // wisp escaping from the bun (cute detail)
      hr.poly([8, -138, 14, -142, 12, -136]).fill({ color: base });
      // sideburns
      hr.rect(-22, -108, 3, 8).fill({ color: base });
      hr.rect(19, -108, 3, 8).fill({ color: base });
    }
  }
}

/** Map a high-level state to a mouth shape. Designed so a given Character
 *  shows ≥ 5 mouth shapes across its lifetime (smile / shocked / grimace
 *  / dead / neutral) — well above the §H6 minimum of 3. */
function mouthForState(state: CharacterState): MouthShape {
  switch (state) {
    case 'IDLE':
    case 'CHEER':
      return 'smile';
    case 'PREP':
      return 'neutral';
    case 'RUSH':
    case 'STRIKE':
    case 'PULL':
      return 'grimace';
    case 'SHAME':
      return 'shocked';
    case 'DEAD':
      return 'dead';
    default:
      return 'neutral';
  }
}

function darken(hex: number, amount: number): number {
  const r = Math.max(0, Math.round(((hex >> 16) & 0xff) * (1 - amount)));
  const g = Math.max(0, Math.round(((hex >> 8) & 0xff) * (1 - amount)));
  const b = Math.max(0, Math.round((hex & 0xff) * (1 - amount)));
  return (r << 16) | (g << 8) | b;
}

function lighten(hex: number, amount: number): number {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) + (255 - ((hex >> 16) & 0xff)) * amount));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) + (255 - ((hex >> 8) & 0xff)) * amount));
  const b = Math.min(255, Math.round((hex & 0xff) + (255 - (hex & 0xff)) * amount));
  return (r << 16) | (g << 8) | b;
}
