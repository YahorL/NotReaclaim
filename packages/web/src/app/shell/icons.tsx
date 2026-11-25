import type { ReactElement, ReactNode } from 'react';

export interface IconProps {
  size?: number;
  className?: string;
}

function Ic({
  size = 18, className, d, fill = 'none', sw = 1.8, children,
}: IconProps & { d?: string; fill?: string; sw?: number; children?: ReactNode }): ReactElement {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill={fill}
      stroke={fill === 'none' ? 'currentColor' : 'none'} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

/** Shared by `planner` (nav) and `calendar` (due-date meta): the same glyph under two names. */
const calendarIcon = (p: IconProps) => <Ic {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Ic>;

export const Icons = {
  planner: calendarIcon,
  priorities: (p: IconProps) => <Ic {...p} d="M5 20v-6M12 20V5M19 20v-10" />,
  stats: (p: IconProps) => <Ic {...p}><path d="M3.5 18a9 9 0 1 1 17 0" /><path d="M12 14l4-4" /></Ic>,
  timeblock: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></Ic>,
  chevDown: (p: IconProps) => <Ic {...p} d="M6 9l6 6 6-6" />,
  chevUp: (p: IconProps) => <Ic {...p} d="M6 15l6-6 6 6" />,
  search: (p: IconProps) => <Ic {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></Ic>,
  filter: (p: IconProps) => <Ic {...p} d="M3 5h18M6 12h12M10 19h4" />,
  columns: (p: IconProps) => <Ic {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></Ic>,
  plus: (p: IconProps) => <Ic {...p} d="M12 5v14M5 12h14" />,
  minusCircle: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></Ic>,
  plusCircle: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></Ic>,
  clock: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ic>,
  dots: (p: IconProps) => <Ic {...p}><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></Ic>,
  check: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.2l2.3 2.3 4.7-4.8" /></Ic>,
  calendar: calendarIcon,
  close: (p: IconProps) => <Ic {...p} d="M6 6l12 12M18 6L6 18" />,
  info: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r=".6" fill="currentColor" stroke="none" /></Ic>,
  panelLeft: (p: IconProps) => <Ic {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M9 4.5v15" /><path d="M6.4 9.5 4.4 12l2 2.5" /></Ic>,
  panelRight: (p: IconProps) => <Ic {...p}><rect x="3" y="4.5" width="18" height="15" rx="2.5" /><path d="M15 4.5v15" /><path d="M17.6 9.5 19.6 12l-2 2.5" /></Ic>,
  settings: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Ic>,
  emoji: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><circle cx="9" cy="9.5" r=".7" fill="currentColor" stroke="none" /><circle cx="15" cy="9.5" r=".7" fill="currentColor" stroke="none" /></Ic>,
  // ---- liquid-glass redesign (P2). Paths from notreclaim-redesign/prototype/*.dc.html where the
  // design has the glyph; pin/play/stop/user are drawn to match (same 24 grid, 1.8 stroke). ----
  habits: (p: IconProps) => <Ic {...p}><path d="M17 2l3 3-3 3" /><path d="M3 11V9a4 4 0 0 1 4-4h13" /><path d="M7 22l-3-3 3-3" /><path d="M21 13v2a4 4 0 0 1-4 4H4" /></Ic>,
  buffers: (p: IconProps) => <Ic {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></Ic>,
  hours: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Ic>,
  sun: (p: IconProps) => <Ic {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Ic>,
  moon: (p: IconProps) => <Ic {...p} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  lock: (p: IconProps) => <Ic {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Ic>,
  pin: (p: IconProps) => <Ic {...p}><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" /><path d="M12 14v7" /></Ic>,
  refresh: (p: IconProps) => <Ic {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></Ic>,
  warning: (p: IconProps) => <Ic {...p}><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v5M12 18h.01" /></Ic>,
  play: (p: IconProps) => <Ic {...p} d="M8 5.5v13l10.5-6.5L8 5.5z" />,
  stop: (p: IconProps) => <Ic {...p}><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Ic>,
  user: (p: IconProps) => <Ic {...p}><circle cx="12" cy="8.5" r="3.8" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></Ic>,
  /** The 2×3 drag-handle dots (filled; the prototype's 10×16 glyph centred on the 24 grid). */
  grip: (p: IconProps) => <Ic {...p} fill="currentColor"><circle cx="9.5" cy="7" r="1.6" /><circle cx="14.5" cy="7" r="1.6" /><circle cx="9.5" cy="12" r="1.6" /><circle cx="14.5" cy="12" r="1.6" /><circle cx="9.5" cy="17" r="1.6" /><circle cx="14.5" cy="17" r="1.6" /></Ic>,
  chevLeft: (p: IconProps) => <Ic {...p} d="M15 6l-6 6 6 6" />,
  chevRight: (p: IconProps) => <Ic {...p} d="M9 6l6 6-6 6" />,
  /** Stepper "−" (prototype `.step`); pairs with `plus`. */
  minus: (p: IconProps) => <Ic {...p} d="M5 12h14" />,
} satisfies Record<string, (p: IconProps) => ReactElement>;

export type IconName = keyof typeof Icons;
