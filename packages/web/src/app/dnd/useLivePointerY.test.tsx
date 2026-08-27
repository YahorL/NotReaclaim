import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLivePointerY } from './useLivePointerY';

/** jsdom has no PointerEvent constructor; a MouseEvent typed `pointermove` carries clientY fine. */
function pointerMove(clientY: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientY, bubbles: true }));
}

/** jsdom has no TouchEvent/Touch constructors either; the handler only reads `touches[0].clientY`. */
function touchMove(clientY: number) {
  window.dispatchEvent(Object.assign(new Event('touchmove', { bubbles: true }), { touches: [{ clientY }] }));
}

describe('useLivePointerY', () => {
  it('is null until the pointer moves', () => {
    const { result } = renderHook(() => useLivePointerY(true));
    expect(result.current.current).toBeNull();
  });

  it('tracks the pointer while armed', () => {
    const { result } = renderHook(() => useLivePointerY(true));
    pointerMove(240);
    expect(result.current.current).toBe(240);
    pointerMove(915);
    expect(result.current.current).toBe(915);
  });

  it('tracks touchmove too, in case pointermove delivery is cut short', () => {
    // A pointercancel (browser scroll/gesture takeover) stops pointermove while dnd-kit's own
    // touchmove-driven drag keeps going — without this the drop slot freezes at the last pointer.
    const { result } = renderHook(() => useLivePointerY(true));
    touchMove(430);
    expect(result.current.current).toBe(430);
  });

  it('ignores the pointer while disarmed', () => {
    const { result } = renderHook(() => useLivePointerY(false));
    pointerMove(240);
    expect(result.current.current).toBeNull();
  });

  it('clears and stops tracking when the drag ends', () => {
    const { result, rerender } = renderHook(({ on }) => useLivePointerY(on), { initialProps: { on: true } });
    pointerMove(240);
    expect(result.current.current).toBe(240);
    rerender({ on: false });
    // Stale coordinates must not survive into the next drag, whose first frame would otherwise
    // resolve against wherever the previous drag was released.
    expect(result.current.current).toBeNull();
    pointerMove(600);
    expect(result.current.current).toBeNull();
  });

  it('detaches its listener on unmount', () => {
    const { result, unmount } = renderHook(() => useLivePointerY(true));
    const ref = result.current;
    unmount();
    pointerMove(777);
    expect(ref.current).toBeNull();
  });
});
