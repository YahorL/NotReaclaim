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

/** The IANA areas new zones are still added under (a zone newer than the browser's ICU is in one). */
const IANA_AREAS = new Set(['Africa', 'America', 'Antarctica', 'Arctic', 'Asia', 'Atlantic', 'Australia', 'Europe', 'Indian', 'Pacific', 'Etc']);

/**
 * The zone to render a stored `settings.timezone` in, agreeing with the server, which plans in UTC
 * when the stored zone fails core's `isValidTimezone` (packages/core/src/time-windows.ts: a zone
 * the ICU knows, not starting with `+`/`-`; the web does not import core, so it is mirrored here).
 * - not loaded yet (`undefined`) → `browserZone`;
 * - `''` or a bare offset (`+03:00`, which Intl itself may accept) → UTC;
 * - a zone this browser's Intl knows → that zone;
 * - one it does not know: in a real IANA area it may just be newer than this browser's ICU (the
 *   server can still accept it) → `browserZone`, as before; anything else (`Not/AZone`, `local`,
 *   `New York`) is invalid on the server too → UTC.
 */
export function resolveSettingsZone(stored: string | undefined, browserZone: string): string {
  if (stored === undefined) return browserZone;
  if (stored === '' || /^[+-]/.test(stored)) return 'UTC';
  if (isSupportedZone(stored)) return stored;
  return IANA_AREAS.has(stored.split('/')[0]!) && stored.includes('/') ? browserZone : 'UTC';
}

/**
 * The zone every time in the app renders and is entered in: `settings.timezone`. Until settings
 * have loaded it falls back to the browser's zone (the planner's long-standing fallback), so
 * anything seeded from it must re-seed when the real zone lands — see `useZoneChange`. A stored
 * zone the server rejects renders in UTC, as the server plans it; a valid one this browser cannot
 * format in falls back to the browser zone, instead of crashing every label on the page.
 */
export function useTimezone(): string {
  const settingsQ = useSettingsQuery();
  return resolveSettingsZone(settingsQ.data?.timezone, browserTimezone());
}

/**
 * Calls `onChange(prev, next)` after a render in which `zone` differs from the previous render's.
 * Forms use it to re-seed wall-clock fields they filled in the fallback zone once settings load,
 * so what is submitted is always read in the zone it was seeded in.
 */
export function useZoneChange(zone: string, onChange: (prev: string, next: string) => void): void {
  useValueChange(zone, onChange);
}
