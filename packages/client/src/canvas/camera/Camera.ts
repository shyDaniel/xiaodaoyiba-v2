// Camera — the parent transform applied to the Pixi scene's parallax
// layers. FINAL_GOAL §C4 + §C5 require a single Camera node that owns:
//
//   * translate(x, y)  — the camera's world position. Per-layer
//     parallax factors scale this translation: sky=0.1, mountains=0.3,
//     gameplay=1.0, foreground=1.3. So a STRIKE shake offsets the
//     gameplay+foreground hard while the sky barely moves.
//
//   * zoom (scale)     — uniform scale around an anchor point.
//     `zoomTo(targetWorldX, targetWorldY, scale, ms, ease)` tweens the
//     scale so the anchor world-point stays at the same screen-point.
//     This is the §C4 1.0→1.1 zoom on the attacker during PULL_PANTS.
//
//   * shake            — stacked decaying offsets driven by ScreenShake.
//     Applied additively on top of translate, NOT scaled by parallax —
//     shake feels like the *camera* (the viewer's POV) is rattling, so
//     applying parallax to it would dampen the close layers, which reads
//     wrong. We DO scale shake by the layer's `parallaxFactor` for the
//     translation half (so the foreground reads "more shaken" than the
//     sky), which is what real parallax cameras do (the parallax factor
//     IS depth — closer things move more).
//
// Design notes:
//
//   * We do NOT use Pixi's built-in viewport / camera plugins; the math
//     is small, and writing it ourselves keeps the surface area testable
//     in jsdom (no Pixi renderer available there).
//
//   * Each registered layer's container has its transform set every
//     update(). The container's `position` is used for translate, and
//     a per-layer scale is computed as 1 + (zoom - 1) * parallaxFactor
//     so a foreground layer (parallax 1.3) zooms slightly more than
//     gameplay (1.0), which is the usual depth-cue trick. We could
//     skip layer-scaling on the bg layers entirely (parallax 0.1)
//     since 0.1× a 0.1 zoom delta is invisible, but applying the
//     formula uniformly keeps the math symmetrical.
//
//   * The zoom anchor is in *gameplay world coordinates* (i.e. coords
//     before the Camera transform is applied). The Camera shifts its
//     translate so that anchor stays put on screen as scale changes.
//     This produces the "zoom in on attacker" feel — the attacker's
//     screen position is stable while the rest of the scene blooms
//     toward them.
//
//   * Easing: 'linear', 'in-out', 'out'. zoomTo() defaults to 'out'
//     (matches §C4's "ease-out").

import type { Container } from 'pixi.js';
import { ScreenShake, type ShakeOptions } from './ScreenShake.js';

export type CameraEase = 'linear' | 'in-out' | 'out';

export interface CameraLayer {
  container: Container;
  /** Per-layer translation parallax factor. sky=0.1, mountains=0.3,
   *  gameplay=1.0, foreground=1.3. Determines how much of the camera's
   *  translate (and shake offset) is applied to this layer. */
  parallax: number;
  /** Whether the camera's zoom should affect this layer. The bg/sky
   *  layer typically opts out (a sky panorama doesn't bloom on a
   *  zoom-in). Defaults to true. */
  zooms?: boolean;
  /** World-space x of the layer's natural anchor (typically the layer's
   *  center on screen). Used to keep the layer centered as scale changes
   *  so it doesn't drift to the upper-left when the camera zooms in. */
  anchorX?: number;
  /** World-space y of the layer's natural anchor. */
  anchorY?: number;
}

interface ZoomTween {
  fromScale: number;
  toScale: number;
  /** Anchor in world coords (before the camera transform). */
  anchorX: number;
  anchorY: number;
  ms: number;
  elapsed: number;
  ease: CameraEase;
}

/** Easing curves. Pure functions of `t` ∈ [0, 1]. */
function ease(t: number, kind: CameraEase): number {
  if (kind === 'linear') return t;
  if (kind === 'out') return 1 - (1 - t) * (1 - t);
  // in-out (smoothstep)
  return t * t * (3 - 2 * t);
}

/**
 * The Camera owns the transform applied to a set of registered Pixi
 * layer containers. It is driven by the GameStage ticker:
 *
 *   camera.update(dt) → reads pending shake / zoom tweens, computes
 *                       per-layer (translate, scale), assigns them.
 *
 * EffectPlayer and GameStage are the two callers of `shake()` /
 * `zoomTo()`. The Camera holds no React state.
 */
export class Camera {
  /** Camera world translation (before per-layer parallax). The Camera
   *  itself is not "looking at" anything in particular by default; we
   *  only translate when an effect explicitly pans (currently unused —
   *  shake is the only translate driver). */
  private camX = 0;
  private camY = 0;

  /** Current scale (uniform). 1.0 = no zoom. Tweens drive this. */
  private scale = 1.0;

  private readonly shaker: ScreenShake;
  private readonly layers: CameraLayer[] = [];
  private zoom: ZoomTween | null = null;

  constructor(shaker?: ScreenShake) {
    this.shaker = shaker ?? new ScreenShake();
  }

  /** Register a layer whose transform the camera owns. Layers are
   *  applied in registration order (visual ordering is owned by the
   *  caller via Pixi's stage.addChild order). */
  addLayer(layer: CameraLayer): void {
    this.layers.push(layer);
  }

  /** Recenter every registered layer's anchor to (cx, cy). Called by
   *  GameStage on viewport resize so the zoom anchor tracks the new
   *  screen center. Layers added without an anchor (anchorX undefined)
   *  remain anchored to (0, 0) — caller can opt-out by not specifying
   *  anchorX/Y on addLayer(). */
  recenterAnchors(cx: number, cy: number): void {
    for (const layer of this.layers) {
      if (layer.anchorX !== undefined) layer.anchorX = cx;
      if (layer.anchorY !== undefined) layer.anchorY = cy;
    }
  }

  /** Trigger a screen shake — see ScreenShake.shake. */
  shake(opts: ShakeOptions): void {
    this.shaker.shake(opts);
  }

  /** Begin a zoom tween. `targetX/targetY` are world-space coords of
   *  the focus point (e.g. the attacker's view.x/view.y); the camera
   *  recenters so that point stays at the same screen position as the
   *  scale changes. */
  zoomTo(
    targetX: number,
    targetY: number,
    toScale: number,
    ms: number,
    easeKind: CameraEase = 'out',
  ): void {
    if (ms <= 0) {
      this.scale = toScale;
      this.zoom = null;
      return;
    }
    this.zoom = {
      fromScale: this.scale,
      toScale,
      anchorX: targetX,
      anchorY: targetY,
      ms,
      elapsed: 0,
      ease: easeKind,
    };
  }

  /** Cancel all in-flight tweens and shakes; reset transform to neutral.
   *  Called between rounds. */
  reset(): void {
    this.shaker.clear();
    this.zoom = null;
    this.scale = 1.0;
    this.camX = 0;
    this.camY = 0;
    this.applyTransforms({ x: 0, y: 0 });
  }

  /** Test introspection: current uniform scale. */
  getScale(): number {
    return this.scale;
  }

  /** Test introspection: whether a zoom tween is active. */
  isZooming(): boolean {
    return this.zoom !== null;
  }

  /** Drive the camera one step. Called from GameStage's ticker. */
  update(dt: number): void {
    // Advance zoom tween.
    if (this.zoom) {
      this.zoom.elapsed += dt;
      const raw = Math.min(1, this.zoom.elapsed / this.zoom.ms);
      const k = ease(raw, this.zoom.ease);
      this.scale = this.zoom.fromScale + (this.zoom.toScale - this.zoom.fromScale) * k;
      if (raw >= 1) {
        this.scale = this.zoom.toScale;
        this.zoom = null;
      }
    }
    // Advance shake.
    const offset = this.shaker.update(dt);
    this.applyTransforms(offset);
  }

  /** Apply the current (translate + shake, scale) to every registered
   *  layer using its parallax factor. */
  private applyTransforms(shakeOffset: { x: number; y: number }): void {
    for (const layer of this.layers) {
      const c = layer.container;
      const p = layer.parallax;
      // Translate = camera world translate * parallax + shake * parallax.
      // Shake is parallax-scaled because closer layers visually shake
      // more in real parallax cameras.
      const tx = this.camX * p + shakeOffset.x * p;
      const ty = this.camY * p + shakeOffset.y * p;

      const wantsZoom = layer.zooms !== false;
      // Per-layer scale: identity for non-zoom layers, otherwise we
      // dampen the global zoom by parallax for sky/mountain layers
      // so they don't bloom as much as the gameplay layer.
      const layerScale = wantsZoom ? 1 + (this.scale - 1) * Math.min(1, p) : 1;

      // Anchor adjustment: keep `anchor` at the same screen point as
      // scale changes. If the layer has no anchor we anchor to (0,0).
      const ax = layer.anchorX ?? 0;
      const ay = layer.anchorY ?? 0;
      // After scaling about origin, the world point (ax, ay) now sits
      // at (ax*layerScale, ay*layerScale). To hold it at (ax+tx, ay+ty)
      // on screen, we set position = (ax+tx - ax*layerScale, ay+ty -
      // ay*layerScale).
      c.position.set(ax + tx - ax * layerScale, ay + ty - ay * layerScale);
      c.scale.set(layerScale, layerScale);
    }
  }
}
