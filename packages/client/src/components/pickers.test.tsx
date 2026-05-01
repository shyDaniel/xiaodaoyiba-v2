// TargetPicker + ActionPicker behavior tests (FINAL_GOAL §H3/§H4).
//
// Driven through react-dom/client (no @testing-library) — we render
// each picker into a detached jsdom container, walk the DOM via
// querySelector + data-testid, and dispatch raw click events. The
// pickers' contract is small enough that this is sufficient: emit
// onPick(x) on click, emit onPick(null) when the budget elapses.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TargetPicker, type TargetCandidate } from './TargetPicker.js';
import { ActionPicker } from './ActionPicker.js';

// Tell React this is an act-aware environment so we don't get noisy
// "current testing environment is not configured to support act"
// warnings when synchronously dispatching events.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe('TargetPicker', () => {
  it('renders a clickable card per candidate and emits onPick(id) on click', () => {
    const onPick = vi.fn();
    const candidates: TargetCandidate[] = [
      { id: 'a', nickname: 'Alice', stage: 'ALIVE_CLOTHED' },
      { id: 'b', nickname: 'Bob', stage: 'ALIVE_PANTS_DOWN' },
    ];
    act(() => {
      root.render(
        <TargetPicker candidates={candidates} timeoutMs={0} onPick={onPick} />,
      );
    });
    const aCard = container.querySelector('[data-testid="target-a"]') as HTMLElement | null;
    const bCard = container.querySelector('[data-testid="target-b"]') as HTMLElement | null;
    expect(aCard).not.toBeNull();
    expect(bCard).not.toBeNull();
    act(() => {
      bCard!.click();
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('b');
  });

  it('emits onPick(null) on timeout', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    const candidates: TargetCandidate[] = [
      { id: 'a', nickname: 'Alice', stage: 'ALIVE_CLOTHED' },
    ];
    act(() => {
      root.render(
        <TargetPicker candidates={candidates} timeoutMs={500} onPick={onPick} />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(null);
    vi.useRealTimers();
  });

  // S-524 §K4: hover over the dialog must FREEZE the countdown so a
  // user reading the options is never timed out. Without this, a 5s
  // (or even 8s) budget bleeds out under a hovering pointer and the
  // dialog vanishes mid-read.
  it('pauses the timer while pointer is over the dialog', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    const candidates: TargetCandidate[] = [
      { id: 'a', nickname: 'Alice', stage: 'ALIVE_CLOTHED' },
    ];
    act(() => {
      root.render(
        <TargetPicker candidates={candidates} timeoutMs={500} onPick={onPick} />,
      );
    });
    const dialog = container.querySelector(
      '[data-testid="winner-picker-target-dialog"]',
    ) as HTMLElement;
    expect(dialog).not.toBeNull();
    // Hover BEFORE the timer would have fired.
    act(() => {
      dialog.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(dialog.getAttribute('data-paused')).toBe('true');
    // Move pointer away — countdown resumes from where it left off.
    act(() => {
      dialog.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(null);
    vi.useRealTimers();
  });

  // S-524 §K4: late commit must win the race. If the user clicks at the
  // very last moment (between an interval tick that decided "left <= 0"
  // and the parent's flush of state), the user's pick must NOT be
  // clobbered by a follow-up onPick(null). The hook's commit() flips a
  // synchronous ref the interval inspects.
  it('honors a click that lands in the same tick as timeout', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    const candidates: TargetCandidate[] = [
      { id: 'a', nickname: 'Alice', stage: 'ALIVE_CLOTHED' },
      { id: 'b', nickname: 'Bob', stage: 'ALIVE_PANTS_DOWN' },
    ];
    act(() => {
      root.render(
        <TargetPicker candidates={candidates} timeoutMs={300} onPick={onPick} />,
      );
    });
    const aBtn = container.querySelector(
      '[data-testid="target-a"]',
    ) as HTMLElement;
    // Click after the user has been reading for the full budget — the
    // very last legal moment. The interval may already have queued its
    // timeout fire for this tick.
    act(() => {
      aBtn.click();
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('a');
    vi.useRealTimers();
  });

  it('returns null element when there are no candidates', () => {
    const onPick = vi.fn();
    act(() => {
      root.render(<TargetPicker candidates={[]} timeoutMs={0} onPick={onPick} />);
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('ActionPicker', () => {
  it('shows PULL_PANTS when target is ALIVE_CLOTHED, hides CHOP and PULL_OWN_PANTS_UP', () => {
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ActionPicker
          winnerStage="ALIVE_CLOTHED"
          targetStage="ALIVE_CLOTHED"
          timeoutMs={0}
          onPick={onPick}
        />,
      );
    });
    expect(container.querySelector('[data-testid="action-PULL_PANTS"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="action-CHOP"]')).toBeNull();
    expect(container.querySelector('[data-testid="action-PULL_OWN_PANTS_UP"]')).toBeNull();
  });

  it('shows CHOP when target is ALIVE_PANTS_DOWN', () => {
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ActionPicker
          winnerStage="ALIVE_CLOTHED"
          targetStage="ALIVE_PANTS_DOWN"
          timeoutMs={0}
          onPick={onPick}
        />,
      );
    });
    expect(container.querySelector('[data-testid="action-CHOP"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="action-PULL_PANTS"]')).toBeNull();
  });

  it('exposes PULL_OWN_PANTS_UP when winner is ALIVE_PANTS_DOWN regardless of target', () => {
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ActionPicker
          winnerStage="ALIVE_PANTS_DOWN"
          targetStage="ALIVE_CLOTHED"
          timeoutMs={0}
          onPick={onPick}
        />,
      );
    });
    const selfBtn = container.querySelector(
      '[data-testid="action-PULL_OWN_PANTS_UP"]',
    ) as HTMLElement | null;
    expect(selfBtn).not.toBeNull();
    act(() => {
      selfBtn!.click();
    });
    expect(onPick).toHaveBeenCalledWith('PULL_OWN_PANTS_UP');
  });

  it('emits onPick(null) on timeout', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ActionPicker
          winnerStage="ALIVE_CLOTHED"
          targetStage="ALIVE_CLOTHED"
          timeoutMs={400}
          onPick={onPick}
        />,
      );
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(null);
    vi.useRealTimers();
  });

  // S-524 §K4: hover pauses ActionPicker too, and a late click wins.
  it('pauses while hovered and honors a late click on PULL_OWN_PANTS_UP', () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    act(() => {
      root.render(
        <ActionPicker
          winnerStage="ALIVE_PANTS_DOWN"
          targetStage="ALIVE_CLOTHED"
          timeoutMs={400}
          onPick={onPick}
        />,
      );
    });
    const dialog = container.querySelector(
      '[data-testid="winner-picker-action-dialog"]',
    ) as HTMLElement;
    expect(dialog).not.toBeNull();
    act(() => {
      dialog.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    });
    // Way past the budget — hover holds the timer at bay.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(onPick).not.toHaveBeenCalled();
    // Click the self-restore — must commit even though wall-clock is
    // long past the timeoutMs deadline, because the hover paused the
    // effective elapsed.
    const selfBtn = container.querySelector(
      '[data-testid="action-PULL_OWN_PANTS_UP"]',
    ) as HTMLElement;
    act(() => {
      selfBtn.click();
    });
    // Drain any leftover ticks; nothing else should fire.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('PULL_OWN_PANTS_UP');
    vi.useRealTimers();
  });
});
