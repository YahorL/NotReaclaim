import { useSettingsQuery } from '../../api/queries';
import { browserTimezone } from './settingsForm';
import { useValueChange } from '../components/useValueChange';

const zoneSupport = new Map<string, boolean>();

/**
 * True when this browser's Intl can format in `zone`. The probe is the very call the label
 * helpers make (`Intl.DateTimeFormat(..., { timeZone })`), which throws a RangeError for a zone
 * its ICU does not know — and the server validates zones with Node's ICU, which can be newer.
 * (luxon's `IANAZone.isValidZone` is this same probe in 3.x; doing it directly keeps the check
 * tied to what actually throws, not to a library detail.) Cached: the answer is fixed per browser.
 */
export function isSupportedZone(zone: string): boolean {
  let ok = zoneSupport.get(zone);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
      ok = zone !== '';
    } catch {
      ok = false;
    }
    zoneSupport.set(zone, ok);
  }
  return ok;
}

/** `zone` when it is set and this browser supports it, else `fallback`. */
export function supportedZoneOr(zone: string | undefined, fallback: string): string {
  return zone !== undefined && isSupportedZone(zone) ? zone : fallback;
}

/**
 * The zone every time in the app renders and is entered in: `settings.timezone`. Until settings
 * have loaded it falls back to the browser's zone (the planner's long-standing fallback), so
 * anything seeded from it must re-seed when the real zone lands — see `useZoneChange`. A settings
 * zone this browser cannot format in also falls back, instead of crashing every label on the page.
 */
export function useTimezone(): string {
  const settingsQ = useSettingsQuery();
  return supportedZoneOr(settingsQ.data?.timezone, browserTimezone());
}

/**
 * Calls `onChange(prev, next)` after a render in which `zone` differs from the previous render's.
 * Forms use it to re-seed wall-clock fields they filled in the fallback zone once settings load,
 * so what is submitted is always read in the zone it was seeded in.
 */
export function useZoneChange(zone: string, onChange: (prev: string, next: string) => void): void {
  useValueChange(zone, onChange);
}
