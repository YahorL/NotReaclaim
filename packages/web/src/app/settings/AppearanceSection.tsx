import { useTheme } from '../../theme/useTheme';
import type { ThemePref } from '../../theme/theme';
import { Segmented } from '../forms/Segmented';
import { CAPS_LABEL } from '../forms/controls';

const OPTIONS: { key: ThemePref; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

/**
 * Theme choice incl. "System" (the rail's sun/moon switch only sets an explicit theme), and the
 * phone's only path to it — the rail is hidden below md. Applies instantly; not part of Save.
 */
export function AppearanceSection() {
  const { pref, setPref } = useTheme();
  return (
    <section data-testid="appearance-section" aria-labelledby="appearance-caption" className="glass flex flex-col gap-3.5 rounded-panel px-[22px] py-5">
      <h2 id="appearance-caption" className={CAPS_LABEL}>Appearance</h2>
      <Segmented kind="radiogroup" label="Theme" options={OPTIONS} value={pref} onChange={setPref} />
      <p className="text-[13px] text-fg-2">System follows your device&apos;s light or dark setting.</p>
    </section>
  );
}
