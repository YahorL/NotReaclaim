import { useState } from 'react';

/** Form state plus a typed single-field setter: `set('title', value)`. */
export function useFormState<S extends object>(initial: S | (() => S)) {
  const [form, setForm] = useState<S>(initial);
  const set = <K extends keyof S>(key: K, value: S[K]) => setForm((f) => ({ ...f, [key]: value }));
  return [form, set, setForm] as const;
}
