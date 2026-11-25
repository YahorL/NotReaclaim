import type { ReactElement, ReactNode } from 'react';
import { Sheet } from './Sheet';

/**
 * The desktop drawer slot: right edge, top aligned with the shell's content area. AppShell
 * measures that top into `--drawer-top` (the header wraps onto two rows below ~1150px, and the
 * Google banner can sit above the content too); 120px is the one-row header's value, used before
 * the first measurement and wherever a page renders without the shell.
 */
export const DESKTOP_DRAWER_SLOT = 'fixed right-3 top-[var(--drawer-top,120px)]';

export interface DrawerHostProps {
  /** Below md: host the drawer in a full-screen Sheet instead of the desktop panel slot. */
  compact: boolean;
  /** Accessible name for the compact sheet, e.g. "Edit task". */
  label: string;
  onClose: () => void;
  /** Literal Tailwind class string for the desktop host element (JIT-visible at the call site). */
  desktopClass: string;
  children: ReactNode;
}

/**
 * One host, two shells. At md+ the drawer keeps the exact wrapper it has always had; below md it
 * becomes a full-screen Sheet, which brings the backdrop, the ✕, Escape, the focus trap and the
 * modal z-tier with it. The drawer element itself is built once by the caller and handed to
 * whichever shell renders it — never duplicated per branch.
 */
export function DrawerHost({ compact, label, onClose, desktopClass, children }: DrawerHostProps): ReactElement {
  if (compact) {
    return <Sheet label={label} onClose={onClose} fullScreen scrollBody>{children}</Sheet>;
  }
  return <div className={desktopClass}>{children}</div>;
}
