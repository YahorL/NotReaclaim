import { useState, useEffect, useRef, type RefObject } from 'react';

/** Track an element's content-box width via ResizeObserver. Returns [ref, width]; width is -1
 *  (the "not measured yet" sentinel) until the first measurement, and stays -1 in jsdom. */
export function useElementWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(-1);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === 'number') setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
