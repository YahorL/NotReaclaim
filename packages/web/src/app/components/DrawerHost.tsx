import type { ReactElement, ReactNode } from 'react';
import { Sheet } from './Sheet';

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
