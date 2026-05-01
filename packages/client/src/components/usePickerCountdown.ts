// Shared countdown hook for TargetPicker / ActionPicker (FINAL_GOAL §K4
// fix S-524 — winner-picker auto-resolves before user can click).
//
// The v5/v6 picker had a hard 5s timeout that fired onPick(null) even
// while the user was reading the dialog. Live MCP repro: I won R4 with
// PANTS_DOWN, ActionPicker rendered with 穿好裤衩 + 咔嚓, and within
// ≤5s the dialog vanished and the engine fast-forwarded to CHOP→小芳
// instead of my intended PULL_OWN_PANTS_UP click. This hook fixes two
// related bugs:
//
//   1. **Hover/keyboard pause** — while the user is reading (pointer
//      over the dialog) or interacting (a focusable child has focus),
//      the countdown freezes. Resumes when both signals clear.
//   2. **Race-safe commit** — when the user clicks a button at the
//      very last moment, the interval may fire `onPick(null)` AFTER
//      the click handler queued `onPick(value)`. The hook exposes a
//      `commit()` that flips a synchronous ref the interval respects;
//      the next tick short-circuits and the user's choice wins.
//
// The default budget is bumped from 5s to 8s so a first-time viewer
// has time to read both options + their hint text. The hook also
// returns `paused` so the parent can dim the progress bar.

import { useCallback, useEffect, useRef, useState } from 'react';

const TICK_MS = 100;

export interface CountdownState {
  /** Remaining budget in ms (frozen while paused). */
  remaining: number;
  /** True while pointer is over the dialog or a child has focus. */
  paused: boolean;
  /** Call when the user commits a choice. Future timer ticks become
   *  no-ops. Idempotent. */
  commit: () => void;
  /** Ref callback — attach to the dialog root so we can wire native
   *  mouseenter/mouseleave/focusin/focusout listeners. React's
   *  synthetic onMouseEnter is delegated through onMouseOver and is
   *  brittle to test via jsdom's native event dispatch; native
   *  listeners are robust and behave identically in real browsers. */
  attachRef: (el: HTMLElement | null) => void;
}

export function usePickerCountdown(
  timeoutMs: number,
  onTimeout: () => void,
): CountdownState {
  const [remaining, setRemaining] = useState(timeoutMs);
  const [paused, setPaused] = useState(false);

  // Refs that the interval reads synchronously. Using refs (not state)
  // guarantees the interval observes the latest value WITHOUT having
  // to be torn down + re-created on every paused/committed change —
  // which would itself reset the elapsed clock and create new races.
  const committedRef = useRef(false);
  const pausedRef = useRef(false);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  // Cumulative pause duration (ms). Subtracted from wall-clock to get
  // effective elapsed.
  const pausedTotalRef = useRef(0);
  // Wall-clock at which the current pause window started (0 = not in
  // a pause window).
  const pauseStartedAtRef = useRef(0);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const commit = useCallback(() => {
    committedRef.current = true;
  }, []);

  const updatePaused = useCallback(() => {
    const next = hoverRef.current || focusRef.current;
    if (next === pausedRef.current) return;
    pausedRef.current = next;
    if (next) {
      pauseStartedAtRef.current = Date.now();
    } else {
      // Resume: fold the just-finished pause window into the cumulative
      // total. From the interval's perspective, time stood still.
      if (pauseStartedAtRef.current > 0) {
        pausedTotalRef.current += Date.now() - pauseStartedAtRef.current;
        pauseStartedAtRef.current = 0;
      }
    }
    setPaused(next);
  }, []);

  // Ref callback that wires native DOM listeners on the dialog root.
  // We track the currently-attached element so a re-mount cleans up
  // its old listeners before binding new ones.
  const attachedElRef = useRef<HTMLElement | null>(null);
  const onEnter = useCallback(() => {
    hoverRef.current = true;
    updatePaused();
  }, [updatePaused]);
  const onLeave = useCallback(() => {
    hoverRef.current = false;
    updatePaused();
  }, [updatePaused]);
  const onFocusIn = useCallback(() => {
    focusRef.current = true;
    updatePaused();
  }, [updatePaused]);
  const onFocusOut = useCallback(() => {
    focusRef.current = false;
    updatePaused();
  }, [updatePaused]);
  const detach = useCallback(() => {
    const el = attachedElRef.current;
    if (!el) return;
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
    el.removeEventListener('focusin', onFocusIn);
    el.removeEventListener('focusout', onFocusOut);
    attachedElRef.current = null;
  }, [onEnter, onLeave, onFocusIn, onFocusOut]);
  const attachRef = useCallback(
    (el: HTMLElement | null) => {
      if (attachedElRef.current === el) return;
      detach();
      if (el) {
        el.addEventListener('mouseenter', onEnter);
        el.addEventListener('mouseleave', onLeave);
        el.addEventListener('focusin', onFocusIn);
        el.addEventListener('focusout', onFocusOut);
        attachedElRef.current = el;
      }
    },
    [detach, onEnter, onLeave, onFocusIn, onFocusOut],
  );
  // Cleanup on unmount.
  useEffect(() => detach, [detach]);

  useEffect(() => {
    if (timeoutMs <= 0) return;
    const start = Date.now();
    // Reset on remount (e.g. fresh round) so a new picker starts with a
    // fresh budget.
    committedRef.current = false;
    pausedTotalRef.current = 0;
    pauseStartedAtRef.current = 0;
    setRemaining(timeoutMs);

    const id = window.setInterval(() => {
      // Race-safe: a parent that already received a click-driven
      // onPick has set commit(); we must NOT also fire onTimeout()
      // because the parent's resolver would receive both values and
      // either drop the user's pick (last-write-wins on a stale
      // resolver) or double-resolve.
      if (committedRef.current) {
        window.clearInterval(id);
        return;
      }
      const inPause =
        pauseStartedAtRef.current > 0
          ? Date.now() - pauseStartedAtRef.current
          : 0;
      const elapsed =
        Date.now() - start - pausedTotalRef.current - inPause;
      const left = Math.max(0, timeoutMs - elapsed);
      setRemaining(left);
      if (left <= 0 && !pausedRef.current) {
        window.clearInterval(id);
        // Re-check committedRef synchronously — between the elapsed
        // computation above and this branch, the user might have
        // clicked. The click sets committedRef BEFORE the parent's
        // setState flush, so we see it immediately.
        if (!committedRef.current) {
          onTimeoutRef.current();
        }
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [timeoutMs]);

  return { remaining, paused, commit, attachRef };
}
