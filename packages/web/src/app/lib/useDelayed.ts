import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * How long a write must stay pending before the UI says so. A normal save answers in milliseconds
 * and must not flicker a spinner; a block write that waits behind a replan (seconds) shows one.
 */
export const PENDING_DELAY_MS = 400;

const NONE: ReadonlySet<string> = new Set();

/**
 * The subset of `keys` that has been present for at least `delayMs` (each key on its own clock).
 * A key that leaves `keys` leaves the result in the same render, so the indication never outlives
 * the request. A JS timer rather than a CSS `animation-delay`: the reduced-motion kill switch zeroes
 * every delay, which would bring back the flicker for exactly those users.
 */
export function useDelayedKeys(keys: readonly string[], delayMs: number = PENDING_DELAY_MS): ReadonlySet<string> {
  const sig = [...new Set(keys)].sort().join('\n');
  const [shown, setShown] = useState<ReadonlySet<string>>(NONE);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const current = new Set(sig === '' ? [] : sig.split('\n'));
    for (const [k, t] of timers.current) {
      if (!current.has(k)) { clearTimeout(t); timers.current.delete(k); }
    }
    setShown((prev) => {
      const kept = [...prev].filter((k) => current.has(k));
      return kept.length === prev.size ? prev : new Set(kept);
    });
    for (const k of current) {
      if (timers.current.has(k)) continue;
      timers.current.set(k, setTimeout(() => {
        setShown((prev) => (prev.has(k) ? prev : new Set([...prev, k])));
      }, delayMs));
    }
  }, [sig, delayMs]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  // Filtered in render too: a key that is no longer pending drops out without waiting for the effect.
  return useMemo(() => {
    const current = new Set(sig === '' ? [] : sig.split('\n'));
    const live = [...shown].filter((k) => current.has(k));
    return live.length === shown.size ? shown : new Set(live);
  }, [shown, sig]);
}

/** One flag: true once `on` has stayed true for `delayMs`; false as soon as it is false again. */
export function useDelayedFlag(on: boolean, delayMs: number = PENDING_DELAY_MS): boolean {
  return useDelayedKeys(on ? ['on'] : [], delayMs).has('on');
}
