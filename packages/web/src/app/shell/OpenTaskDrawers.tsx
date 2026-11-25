import { createContext, useContext, useEffect, type ReactNode } from 'react';

/** Task id → how many task drawers have it open right now (page drawers and the shell's own). */
export type OpenTaskDrawers = Map<string, number>;

const Ctx = createContext<OpenTaskDrawers | null>(null);

/**
 * Which tasks have a TaskDrawer open anywhere in the shell. The search palette reads it so it
 * never opens a second drawer on a task a page drawer already holds: each drawer seeds its form
 * once, so the two would hold diverging copies and the stale one's Save could revert the other's
 * edits. A plain mutable map (no re-render on change): it is only read at selection time.
 */
export function OpenTaskDrawersProvider({ value, children }: { value: OpenTaskDrawers; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Registers the calling drawer's task for as long as it is mounted. No-op outside the shell. */
export function useRegisterOpenTaskDrawer(taskId: string): void {
  const open = useContext(Ctx);
  useEffect(() => {
    if (!open) return;
    open.set(taskId, (open.get(taskId) ?? 0) + 1);
    return () => {
      const n = (open.get(taskId) ?? 1) - 1;
      if (n > 0) open.set(taskId, n); else open.delete(taskId);
    };
  }, [open, taskId]);
}
