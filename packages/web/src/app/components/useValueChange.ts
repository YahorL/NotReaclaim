import { useEffect, useRef } from 'react';

/**
 * Calls `onChange(prev, next)` after a render in which `value` differs (`Object.is`) from the
 * previous render's. Forms use it to re-seed defaults they filled before settings loaded: a field
 * still equal to its old seed takes the new one, a field the user edited keeps its value.
 * Object values must be referentially stable (memoised) or this fires on every render.
 */
export function useValueChange<T>(value: T, onChange: (prev: T, next: T) => void): void {
  const prevRef = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    const prev = prevRef.current;
    if (Object.is(prev, value)) return;
    prevRef.current = value;
    onChangeRef.current(prev, value);
  }, [value]);
}
