import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../theme/usePrefersReducedMotion';

/** `animate-shake` length (tailwind.config: shake .45s). */
export const SHAKE_MS = 450;

const nextFrame = (cb: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(cb));
  else setTimeout(cb, 0);
};

/**
 * The locked-tile "no" (spec §5.2): `shaking` is true for one `animate-shake` run. A trigger while
 * a shake is running restarts it — the class has to come off for a painted frame first, or the
 * browser would not replay the animation. Under reduced motion nothing shakes (the caller's toast
 * still says why).
 */
export function useShake(): { shaking: boolean; shake: () => void } {
  const reduced = usePrefersReducedMotion();
  const [shaking, setShaking] = useState(false);
  const shakingRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const start = () => {
    shakingRef.current = true;
    setShaking(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; shakingRef.current = false; setShaking(false); }, SHAKE_MS + 20);
  };

  const shake = () => {
    if (reduced) return;
    if (!shakingRef.current) { start(); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    shakingRef.current = false;
    setShaking(false);
    nextFrame(start);
  };

  return { shaking, shake };
}
