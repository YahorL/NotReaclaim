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
const calendarIcon = (p: IconProps) => <Ic {...p}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></Ic>;

export const Icons = {
  planner: calendarIcon,
  priorities: (p: IconProps) => <Ic {...p} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  stats: (p: IconProps) => <Ic {...p}><path d="M21 12a9 9 0 1 1-9-9" /><path d="M21 5.5 12 12" /></Ic>,
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
} satisfies Record<string, (p: IconProps) => ReactElement>;

export type IconName = keyof typeof Icons;
