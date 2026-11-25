import { useTheme } from '../../theme/useTheme';
import type { Theme } from '../../theme/theme';
import { Icons } from './icons';
import { RAIL_GROUP, RAIL_TOOLTIP } from './NavItem';

const BTN = 'relative flex h-[38px] w-[38px] [@media(max-height:760px)]:h-[34px] [@media(max-height:760px)]:w-[34px] items-center justify-center rounded-full transition-[background-color,color,box-shadow] duration-200 [&_svg]:transition-transform [&_svg]:duration-[450ms] [&_svg]:ease-pop hover:[&_svg]:-rotate-[20deg] hover:[&_svg]:scale-[1.08]';
const BTN_IDLE = `${BTN} text-fg/[.62] hover:bg-fg/[.09] hover:text-fg ${RAIL_TOOLTIP}`;
// The knob: a lighter disc in dark, a white raised disc in light (prototype `.navi.th.on`).
const BTN_ON = `${BTN} bg-fg/[.14] text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] [[data-theme=light]_&]:bg-white [[data-theme=light]_&]:shadow-[0_4px_12px_-4px_rgba(20,22,30,0.3),inset_0_1px_0_#fff] ${RAIL_TOOLTIP}`;

const OPTIONS: Array<{ theme: Theme; label: string; Icon: (typeof Icons)['sun'] }> = [
  { theme: 'light', label: 'Light mode', Icon: Icons.sun },
  { theme: 'dark', label: 'Dark mode', Icon: Icons.moon },
];

/**
 * Sun/moon pair in the rail. Clicking sets an explicit pref (persisted in `nr.theme`); "System"
 * lives in Settings → Appearance. `aria-pressed` follows the RESOLVED theme, so exactly one button
 * is pressed even while the pref is 'system'. The newly active icon spins in (`th-in`; the CSS
 * reduced-motion kill switch covers it).
 */
export function ThemeSwitch() {
  const { theme, setPref } = useTheme();
  return (
    <div role="group" aria-label="Theme" className={RAIL_GROUP}>
      {OPTIONS.map(({ theme: t, label, Icon }) => {
        const on = theme === t;
        return (
          <button
            key={t} type="button" aria-label={label} data-label={label} aria-pressed={on}
            onClick={() => setPref(t)}
            className={on ? BTN_ON : BTN_IDLE}
          >
            <Icon size={18} className={on ? 'animate-th-in' : undefined} />
          </button>
        );
      })}
    </div>
  );
}
