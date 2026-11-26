import type { ReactElement } from 'react';
import { Icons, type IconProps } from './icons';

/**
 * The glyph of a Start / Stop button: its own icon, or — while the request has been waiting a
 * while — the Re-plan button's spinning refresh glyph in the same box (no layout shift; static
 * under reduced motion, like the Re-plan spinner). Decorative: the button carries `aria-busy`.
 */
export function ActionIcon({ pending, icon: Icon, size }: { pending: boolean; icon: (p: IconProps) => ReactElement; size: number }) {
  return pending
    ? <span data-testid="action-pending" className="inline-flex"><Icons.refresh size={size} className="animate-spin" /></span>
    : <Icon size={size} />;
}
