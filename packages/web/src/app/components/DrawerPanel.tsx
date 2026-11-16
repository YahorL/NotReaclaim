import { useRef, type ReactNode } from 'react';
import { useClickOutside } from './useClickOutside';
import { FIELD_ERROR } from './formStyles';

const PANEL = 'w-[440px] shrink-0 space-y-2.5 rounded-[14px] border border-line bg-card p-4 shadow-pop max-h-[calc(100dvh-100px)] overflow-y-auto';
const PANEL_COMPACT = 'w-full space-y-2.5 p-2';
const ACTIONS = 'flex gap-2 pt-1';
const ACTIONS_CENTERED = 'flex items-center gap-2 pt-1';

export interface DrawerPanelProps {
  testId: string;
  title: string;
  /** Hosted in a full-screen Sheet below md: drop the 440px panel chrome and the self-dismiss. */
  compact: boolean;
  /** Called on a pointerdown outside the panel (desktop only — the Sheet owns dismissal on compact). */
  onDismiss: () => void;
  /** A save/request error shown above the actions row. */
  error?: { message: string } | null;
  actions: ReactNode;
  /** Vertically centre the actions row (for rows mixing button sizes). */
  centerActions?: boolean;
  children: ReactNode;
}

/** The shell shared by the edit drawers: panel chrome, outside-click dismissal, heading, error line, actions row. */
export function DrawerPanel({ testId, title, compact, onDismiss, error = null, actions, centerActions = false, children }: DrawerPanelProps) {
  const rootRef = useRef<HTMLElement>(null);
  useClickOutside(rootRef, onDismiss, !compact);
  return (
    <aside ref={rootRef} data-testid={testId} className={compact ? PANEL_COMPACT : PANEL}>
      <h4 className="text-[15px] font-bold text-ink">{title}</h4>
      {children}
      {error && <p data-testid="drawer-error" className={FIELD_ERROR}>{error.message}</p>}
      <div className={centerActions ? ACTIONS_CENTERED : ACTIONS}>{actions}</div>
    </aside>
  );
}
