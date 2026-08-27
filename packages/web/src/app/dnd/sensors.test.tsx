import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MouseSensor, TouchSensor, KeyboardSensor, type ClientRect, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import {
  useAppSensors, useDragToScheduleSensors, pointerFirstCollision,
  FINE_DRAG_ACTIVATION, COARSE_DRAG_ACTIVATION,
} from './sensors';

const rect = (top: number, left: number, height: number, width: number): ClientRect => ({
  top, left, height, width, right: left + width, bottom: top + height,
});

/**
 * Both strategies read only `collisionRect`, `droppableRects`, `droppableContainers[].id` and
 * `pointerCoordinates`; the rest of the args object is never touched, so one cast at the boundary
 * keeps the fixture honest and small.
 */
type CollisionArgs = Parameters<typeof pointerFirstCollision>[0];

function collisionArgs(pointer: { x: number; y: number } | null): CollisionArgs {
  const rects = new Map<string, ClientRect>([
    ['column', rect(0, 0, 600, 300)],
    ['card', rect(200, 0, 60, 300)],
  ]);
  return {
    active: { id: 'a', data: { current: undefined }, rect: { current: { initial: null, translated: null } } },
    collisionRect: rect(1000, 1000, 60, 300), // far away: closestCenter must not tie with pointerWithin
    droppableRects: rects,
    droppableContainers: [
      { id: 'column', key: 'column', data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: rects.get('column')! } },
      { id: 'card', key: 'card', data: { current: undefined }, disabled: false, node: { current: null }, rect: { current: rects.get('card')! } },
    ],
    pointerCoordinates: pointer,
  } as unknown as CollisionArgs;
}

describe('drag activation constants', () => {
  it('fine pointers need a small movement so a click stays a click', () => {
    expect(FINE_DRAG_ACTIVATION).toEqual({ distance: 4 });
  });

  it('coarse pointers need a hold so a scroll stays a scroll', () => {
    expect(COARSE_DRAG_ACTIVATION).toEqual({ delay: 250, tolerance: 8 });
  });
});

describe('useAppSensors', () => {
  it('registers mouse, touch and keyboard sensors with the shared constraints', () => {
    const { result } = renderHook(() => useAppSensors());
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor, KeyboardSensor]);
    expect(result.current[0]!.options).toEqual({ activationConstraint: FINE_DRAG_ACTIVATION });
    expect(result.current[1]!.options).toEqual({ activationConstraint: COARSE_DRAG_ACTIVATION });
  });

  it('gives the keyboard sensor the sortable coordinate getter', () => {
    const { result } = renderHook(() => useAppSensors());
    expect(typeof (result.current[2]!.options as { coordinateGetter?: unknown }).coordinateGetter).toBe('function');
    // The default is the stock sortable getter, not merely "some function": a surface with no
    // container droppables must keep dnd-kit's own arrow behaviour.
    expect((result.current[2]!.options as { coordinateGetter?: unknown }).coordinateGetter)
      .toBe(sortableKeyboardCoordinates);
  });

  it('lets a surface override the keyboard coordinate getter', () => {
    // The priorities board passes its own container-blind getter; every other caller keeps default.
    const custom: KeyboardCoordinateGetter = () => ({ x: 1, y: 2 });
    const { result } = renderHook(() => useAppSensors(custom));
    expect((result.current[2]!.options as { coordinateGetter?: unknown }).coordinateGetter).toBe(custom);
  });
});

describe('useDragToScheduleSensors', () => {
  it('omits the keyboard sensor — day columns have no keyboard coordinate story', () => {
    const { result } = renderHook(() => useDragToScheduleSensors());
    expect(result.current.map((s) => s.sensor)).toEqual([MouseSensor, TouchSensor]);
  });
});

describe('pointerFirstCollision', () => {
  it('prefers the smallest droppable under the pointer', () => {
    const hits = pointerFirstCollision(collisionArgs({ x: 150, y: 230 }));
    expect(hits[0]!.id).toBe('card'); // inside both; the card's corners are nearer
  });

  it('returns only the enclosing container when the pointer is in its empty area', () => {
    const hits = pointerFirstCollision(collisionArgs({ x: 150, y: 500 }));
    expect(hits.map((h) => h.id)).toEqual(['column']);
  });

  it('falls back to closestCenter when there are no pointer coordinates (keyboard drags)', () => {
    const hits = pointerFirstCollision(collisionArgs(null));
    expect(hits.length).toBe(2); // pointerWithin would have returned []
  });

  it('returns nothing when the pointer is inside no droppable at all', () => {
    // An off-target pointer drop must produce no `over`, so the drop handler no-ops exactly as the
    // old HTML5 path did. The centre-distance fallback would instead have named the nearest
    // enabled droppable and silently moved the card there.
    expect(pointerFirstCollision(collisionArgs({ x: 5000, y: 5000 }))).toEqual([]);
  });
});
