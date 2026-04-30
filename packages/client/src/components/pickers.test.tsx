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
});
