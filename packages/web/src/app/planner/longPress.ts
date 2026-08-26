/**
 * The arming decisions behind touch drag on the planner grid, kept pure so they can be tested:
 * jsdom cannot produce a real gesture, so the component only wires timers/capture around this.
 *
 * Both constants are exported for tuning after a real-device pass (spec §5 flags long-press vs.
 * scroll as needing device iteration).
 */
export const LONG_PRESS_MS = 350;
export const LONG_PRESS_SLOP_PX = 8;

export type PressPhase =
  /** No press, or a press we abandoned because the finger started scrolling. */
  | 'idle'
  /** Coarse pointer, finger down, waiting out the long-press timer. */
  | 'pending'
  /** The drag owns the pointer: moves become block movement. */
  | 'armed';

export interface PressState {
  phase: PressPhase;
  originX: number;
  originY: number;
}

export const IDLE: PressState = { phase: 'idle', originX: 0, originY: 0 };

/**
 * A press begins. `deferred` is true only for a coarse-pointer body move: a mouse press is a
 * drag immediately (clicks are still discriminated by zero delta on release), and the resize
 * handle is an unambiguous target that drags immediately on touch too.
 */
export function beginPress(x: number, y: number, deferred: boolean): PressState {
  return { phase: deferred ? 'pending' : 'armed', originX: x, originY: y };
}

/** Euclidean travel from where the finger landed. */
export function pressDistance(s: PressState, x: number, y: number): number {
  return Math.hypot(x - s.originX, y - s.originY);
}

/**
 * A move while pending past the slop means the user is scrolling, not dragging → give the
 * gesture back to the browser. A move while armed is the drag itself and changes nothing here.
 */
export function pressMove(s: PressState, x: number, y: number, slop = LONG_PRESS_SLOP_PX): PressState {
  if (s.phase !== 'pending') return s;
  return pressDistance(s, x, y) > slop ? IDLE : s;
}

/** The long-press timer fired. */
export function pressArm(s: PressState): PressState {
  return s.phase === 'pending' ? { ...s, phase: 'armed' } : s;
}

export function endPress(): PressState {
  return IDLE;
}

/** Should pointer moves be translated into block movement? */
export function isArmed(s: PressState): boolean {
  return s.phase === 'armed';
}

/** A release while still pending is a tap (open the drawer), never a drag. */
export function isTap(s: PressState): boolean {
  return s.phase === 'pending';
}
