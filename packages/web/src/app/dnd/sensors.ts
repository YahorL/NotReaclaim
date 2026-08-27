import {
  KeyboardSensor, MouseSensor, TouchSensor, closestCenter, pointerWithin, useSensor, useSensors,
  type CollisionDetection, type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Fine pointers (mouse/trackpad/pen): a few pixels of travel before a press becomes a drag, so a
 * plain click still opens the drawer / popover it always did.
 */
export const FINE_DRAG_ACTIVATION = { distance: 4 };

/**
 * Coarse pointers: a short hold before a press becomes a drag, and a movement tolerance that
 * cancels the pending drag if the finger travels first — so a flick stays a scroll. This is the
 * same idiom the planner's own long-press uses, and it is why no `touch-action` is needed on
 * sortable items (setting `touch-none` would kill the board's horizontal scroll).
 */
export const COARSE_DRAG_ACTIVATION = { delay: 250, tolerance: 8 };

/**
 * Shared sensors for the sortable surfaces (priorities board, card subtasks, drawer subtasks).
 *
 * `MouseSensor` rather than `PointerSensor` on purpose: a pointer sensor also receives touch
 * input, so its distance constraint would steal every touch scroll. Splitting mouse (onMouseDown)
 * from touch (onTouchStart) picks the right constraint per gesture rather than per device.
 */
export function useAppSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: FINE_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: COARSE_DRAG_ACTIVATION }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/**
 * Sensors for drag-to-schedule. Same two pointer sensors, no keyboard sensor: a day column is a
 * continuous 24-hour surface with no discrete keyboard coordinates, and inventing one is out of
 * scope (spec section 3 covers list reordering only).
 */
export function useDragToScheduleSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: FINE_DRAG_ACTIVATION }),
    useSensor(TouchSensor, { activationConstraint: COARSE_DRAG_ACTIVATION }),
  );
}

/**
 * Pointer-first collision detection with a centre-distance fallback.
 *
 * `pointerWithin` is what nested targets want: hovering a card inside a column returns both, sorted
 * by distance from the pointer to the rect corners, so the small card wins and the tall column only
 * wins in its own empty area — exactly the old dragover/`stopPropagation` layering. But it returns
 * nothing without pointer coordinates, which is every keyboard drag, so fall back to `closestCenter`.
 */
export const pointerFirstCollision: CollisionDetection = (args) => {
  const withinPointer = pointerWithin(args);
  return withinPointer.length > 0 ? withinPointer : closestCenter(args);
};
