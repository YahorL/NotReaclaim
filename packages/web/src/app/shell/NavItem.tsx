import { NavLink, useMatch, useResolvedPath } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Rail tooltip: the item's `data-label` rendered by `::after`, sliding in 6px on hover and on
 * keyboard focus (prototype `.navi::after`). Decorative — the accessible name is `aria-label`.
 * Shared with ThemeSwitch. Literal string so the JIT sees every utility.
 */
export const RAIL_TOOLTIP =
  'after:pointer-events-none after:absolute after:left-[calc(100%+16px)] after:top-1/2 after:z-50 after:h-8 after:-translate-x-1.5 after:-translate-y-1/2 after:whitespace-nowrap after:rounded-pill after:border after:border-fg/[.12] after:bg-card/95 after:px-3 after:text-[13px] after:font-medium after:leading-8 after:text-fg after:opacity-0 after:shadow-pop after:transition after:duration-150 after:content-[attr(data-label)] hover:after:translate-x-0 hover:after:opacity-100 focus-visible:after:translate-x-0 focus-visible:after:opacity-100';

/** A recessed "well" holding a group of rail items (prototype `.rail-grp`). */
export const RAIL_GROUP =
  'flex flex-col items-center gap-1 rounded-pill border border-fg/[.06] bg-black/[.22] p-[5px] shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] [[data-theme=light]_&]:bg-black/[.05] [[data-theme=light]_&]:shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)]';

const ITEM = 'relative flex h-[46px] w-[46px] items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-200';
const ITEM_IDLE = `${ITEM} text-fg/[.62] hover:bg-fg/[.09] hover:text-fg ${RAIL_TOOLTIP}`;
const ITEM_ACTIVE = `${ITEM} bg-accent text-on-accent shadow-accent ${RAIL_TOOLTIP}`;

/**
 * Icon-only 46px rail link. Named by `aria-label` (same names as the old text links), labelled
 * visually by a CSS tooltip, and marked `aria-current="page"` + `data-active` on its route.
 */
export function NavLinkItem({ to, label, icon, end = false }: { to: string; label: string; icon: ReactNode; end?: boolean }) {
  // Same match NavLink uses for aria-current, read here so the link can carry `data-active`.
  const active = useMatch({ path: useResolvedPath(to).pathname, end }) != null;
  return (
    <NavLink
      to={to} end={end} aria-label={label} data-label={label} data-active={active || undefined}
      className={active ? ITEM_ACTIVE : ITEM_IDLE}
    >
      {icon}
    </NavLink>
  );
}
