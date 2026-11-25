/**
 * The last input modality — pointer or keyboard — from document capture listeners: the
 * `:focus-visible` heuristic in script form. It classifies focus that a SCRIPT moves: when the
 * planner's detail card closes it hands focus back to its block, and a block focused right after
 * a mouse click on the card's ✕ must behave like a clicked block (arrows scroll), while one focused
 * after Escape behaves like a keyboard-focused block (arrows move it).
 */
export type InputModality = 'pointer' | 'keyboard';

let last: InputModality = 'keyboard';
let installed = false;

/** Installs the listeners once (idempotent). */
export function trackInputModality(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('pointerdown', () => { last = 'pointer'; }, true);
  document.addEventListener('keydown', () => { last = 'keyboard'; }, true);
}

export function lastInputModality(): InputModality {
  return last;
}

/** Tests: forget the previous test's last input. */
export function resetInputModality(): void {
  last = 'keyboard';
}
