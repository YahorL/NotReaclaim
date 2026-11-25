/**
 * Surfaces that own the keyboard while they are open: modal dialogs and sheets, the search
 * palette, the account menu and the desktop create popover. Global shortcuts (`/`, Ctrl+K) and
 * the planner's Escape-to-deselect stand down while any of them is in the document.
 */
export const OVERLAY_OPEN_SELECTOR = '[role="dialog"],[aria-modal="true"],[role="menu"],[data-testid="create-popover"]';

export function isOverlayOpen(doc: Document = document): boolean {
  return doc.querySelector(OVERLAY_OPEN_SELECTOR) !== null;
}
