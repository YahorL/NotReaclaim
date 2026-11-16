import { useEffect, useRef } from 'react';
import { useSettingsQuery } from '../../api/queries';
import { browserTimezone } from './settingsForm';

/**
 * The zone every time in the app renders and is entered in: `settings.timezone`. Until settings
 * have loaded it falls back to the browser's zone (the planner's long-standing fallback), so
 * anything seeded from it must re-seed when the real zone lands — see `useZoneChange`.
 */
export function useTimezone(): string {
  const settingsQ = useSettingsQuery();
  return settingsQ.data?.timezone ?? browserTimezone();
}

/**
 * Calls `onChange(prev, next)` after a render in which `zone` differs from the previous render's.
 * Forms use it to re-seed wall-clock fields they filled in the fallback zone once settings load,
 * so what is submitted is always read in the zone it was seeded in.
 */
export function useZoneChange(zone: string, onChange: (prev: string, next: string) => void): void {
  const prevRef = useRef(zone);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const prev = prevRef.current;
    if (prev === zone) return;
    prevRef.current = zone;
    onChangeRef.current(prev, zone);
  }, [zone]);
}
