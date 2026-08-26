type Listener = (e: MediaQueryListEvent) => void;

export interface FakeMatchMedia {
  /** Flip a query's result and notify every listener registered for it. */
  set(query: string, matches: boolean): void;
  /** Every query the code under test has asked about, in first-ask order. */
  queries(): string[];
  /** Put `window.matchMedia` back the way jsdom had it (undefined). */
  restore(): void;
}

/**
 * jsdom implements no `matchMedia` at all, which is exactly why the production hook treats a
 * missing `matchMedia` as "no match" and every existing test keeps the desktop / fine-pointer
 * path. Tests that need the mobile path install this fake and MUST call `restore()` afterwards.
 */
export function installMatchMedia(initial: Record<string, boolean> = {}): FakeMatchMedia {
  const state = new Map<string, boolean>(Object.entries(initial));
  const listeners = new Map<string, Set<Listener>>();
  const asked: string[] = [];
  const had = Object.prototype.hasOwnProperty.call(window, 'matchMedia');
  const previous = (window as { matchMedia?: unknown }).matchMedia;

  const impl = (query: string): MediaQueryList => {
    if (!asked.includes(query)) asked.push(query);
    const set = listeners.get(query) ?? new Set<Listener>();
    listeners.set(query, set);
    return {
      media: query,
      get matches() { return state.get(query) ?? false; },
      onchange: null,
      addEventListener: (_type: string, fn: Listener) => { set.add(fn); },
      removeEventListener: (_type: string, fn: Listener) => { set.delete(fn); },
      addListener: (fn: Listener) => { set.add(fn); },
      removeListener: (fn: Listener) => { set.delete(fn); },
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;
  };

  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: impl });

  return {
    set(query, matches) {
      state.set(query, matches);
      for (const fn of listeners.get(query) ?? []) fn({ matches, media: query } as MediaQueryListEvent);
    },
    queries: () => [...asked],
    restore() {
      if (had) Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: previous });
      else delete (window as { matchMedia?: unknown }).matchMedia;
    },
  };
}
