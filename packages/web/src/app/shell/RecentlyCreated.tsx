import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * How long a just-created task counts as "fresh". Longer than the 1.3s `animate-fresh` glow on
 * purpose: the planner panel only lists the task after the tasks refetch lands, and the card plays
 * the glow when it mounts with the flag. Removing the class afterwards does not replay anything.
 */
export const FRESH_HOLD_MS = 4000;

export interface RecentlyCreatedApi {
  /** The task the New task dialog created last, while it is fresh; otherwise null. */
  freshTaskId: string | null;
  markCreated: (taskId: string) => void;
}

// Outside a provider (pages and panels rendered bare in tests) nothing is ever fresh.
const NOOP: RecentlyCreatedApi = { freshTaskId: null, markCreated: () => {} };
const Ctx = createContext<RecentlyCreatedApi>(NOOP);

export function useRecentlyCreated(): RecentlyCreatedApi {
  return useContext(Ctx);
}

/** Shell-level hand-off from the New task dialog to the planner panel's glow (spec §4.3). */
export function RecentlyCreatedProvider({ children }: { children: ReactNode }) {
  const [freshTaskId, setFreshTaskId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markCreated = useCallback((taskId: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFreshTaskId(taskId);
    timer.current = setTimeout(() => { timer.current = null; setFreshTaskId(null); }, FRESH_HOLD_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const api = useMemo(() => ({ freshTaskId, markCreated }), [freshTaskId, markCreated]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
