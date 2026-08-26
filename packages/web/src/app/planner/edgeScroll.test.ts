import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { edgeScrollStep, useEdgeAutoScroll, EDGE_ZONE_PX, MAX_EDGE_SCROLL_PX } from './edgeScroll';

const TOP = 100;
const BOTTOM = 700;

describe('edgeScrollStep', () => {
  it('exports tunable constants', () => {
    expect(EDGE_ZONE_PX).toBe(48);
    expect(MAX_EDGE_SCROLL_PX).toBe(14);
  });

  it('does nothing away from the edges', () => {
    expect(edgeScrollStep(400, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(TOP + EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollStep(BOTTOM - EDGE_ZONE_PX, TOP, BOTTOM)).toBe(0);
  });

  it('ramps up as the pointer nears the top edge', () => {
    const near = edgeScrollStep(TOP + 40, TOP, BOTTOM);
    const nearer = edgeScrollStep(TOP + 10, TOP, BOTTOM);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeScrollStep(TOP, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('clamps past the top edge instead of accelerating forever', () => {
    expect(edgeScrollStep(TOP - 500, TOP, BOTTOM)).toBe(-MAX_EDGE_SCROLL_PX);
  });

  it('ramps down as the pointer nears the bottom edge and clamps past it', () => {
    const near = edgeScrollStep(BOTTOM - 40, TOP, BOTTOM);
    expect(near).toBeGreaterThan(0);
    expect(edgeScrollStep(BOTTOM - 10, TOP, BOTTOM)).toBeGreaterThan(near);
    expect(edgeScrollStep(BOTTOM, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
    expect(edgeScrollStep(BOTTOM + 500, TOP, BOTTOM)).toBe(MAX_EDGE_SCROLL_PX);
  });

  it('is inert for a degenerate rect (jsdom measures everything as zero)', () => {
    expect(edgeScrollStep(0, 0, 0)).toBe(0);
    expect(edgeScrollStep(50, 100, 100)).toBe(0);
  });
});

describe('useEdgeAutoScroll', () => {
  /** Pending rAF callbacks, keyed by the id we handed back — a hand-driven frame clock. */
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let realRaf: typeof requestAnimationFrame;
  let realCaf: typeof cancelAnimationFrame;

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    realRaf = globalThis.requestAnimationFrame;
    realCaf = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) => { frames.delete(id); }) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  });

  /** Run every pending frame once; a tick that reschedules leaves a fresh entry behind. */
  const flushFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => { for (const cb of pending) cb(0); });
  };

  function fakeContainer(top = 0, bottom = 600): HTMLElement {
    return {
      scrollTop: 0,
      getBoundingClientRect: () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }),
    } as unknown as HTMLElement;
  }

  it('scrolls the container by one step per frame and reports back the pointer y', () => {
    const el = fakeContainer();
    const onScrolled = vi.fn();
    const { result } = renderHook(() => useEdgeAutoScroll(() => el, onScrolled));

    act(() => { result.current.update(595); });      // deep in the bottom edge zone
    expect(frames.size).toBe(1);

    flushFrame();
    const step = edgeScrollStep(595, 0, 600);
    expect(step).toBeGreaterThan(0);
    expect(el.scrollTop).toBe(step);
    expect(onScrolled).toHaveBeenCalledWith(595);
    expect(frames.size).toBe(1);                     // keeps scrolling while the finger rests

    flushFrame();
    expect(el.scrollTop).toBe(step * 2);
    expect(onScrolled).toHaveBeenCalledTimes(2);

    act(() => { result.current.stop(); });
  });

  it('stops rescheduling once the pointer leaves the edge zone', () => {
    const el = fakeContainer();
    const onScrolled = vi.fn();
    const { result } = renderHook(() => useEdgeAutoScroll(() => el, onScrolled));

    act(() => { result.current.update(300); });      // mid-container: nothing to do
    flushFrame();
    expect(el.scrollTop).toBe(0);
    expect(onScrolled).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);                     // no 60fps spin for the rest of the drag

    act(() => { result.current.update(595); });      // a later move restarts the loop
    expect(frames.size).toBe(1);
    act(() => { result.current.stop(); });
  });

  it('stop() cancels the pending frame', () => {
    const el = fakeContainer();
    const onScrolled = vi.fn();
    const { result } = renderHook(() => useEdgeAutoScroll(() => el, onScrolled));

    act(() => { result.current.update(595); });
    expect(frames.size).toBe(1);
    act(() => { result.current.stop(); });
    expect(frames.size).toBe(0);
    flushFrame();
    expect(el.scrollTop).toBe(0);
    expect(onScrolled).not.toHaveBeenCalled();
  });

  it('cancels the pending frame on unmount', () => {
    const el = fakeContainer();
    const { result, unmount } = renderHook(() => useEdgeAutoScroll(() => el));
    act(() => { result.current.update(595); });
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});
