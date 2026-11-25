import { useCallback, useEffect, useState } from 'react';

/** Which block families the planner shows (true = shown, the toggle is pressed). */
export interface PlannerFilters {
  /** Every calendar event: Google meetings, app events, blocked time (spec Q2 default). */
  meetings: boolean;
  /** Task and habit blocks. */
  movable: boolean;
}

export type PlannerFilterName = keyof PlannerFilters;

export const FILTERS_KEY = 'nr.plannerFilters';
export const ALL_SHOWN: PlannerFilters = { meetings: true, movable: true };

/** Stored filters, tolerating a missing / throwing storage and anything malformed. */
export function readFilters(storage: Pick<Storage, 'getItem'> | null | undefined): PlannerFilters {
  try {
    const raw = storage?.getItem(FILTERS_KEY);
    if (!raw) return ALL_SHOWN;
    const v = JSON.parse(raw) as Partial<Record<PlannerFilterName, unknown>>;
    return {
      meetings: typeof v.meetings === 'boolean' ? v.meetings : true,
      movable: typeof v.movable === 'boolean' ? v.movable : true,
    };
  } catch {
    return ALL_SHOWN;
  }
}

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** The Meetings / Movable toolbar toggles (spec §5.3), persisted per browser. */
export function usePlannerFilters(): { filters: PlannerFilters; toggle: (name: PlannerFilterName) => void } {
  const [filters, setFilters] = useState<PlannerFilters>(() => readFilters(storage()));
  useEffect(() => {
    try { storage()?.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* private mode / blocked */ }
  }, [filters]);
  const toggle = useCallback((name: PlannerFilterName) => setFilters((f) => ({ ...f, [name]: !f[name] })), []);
  return { filters, toggle };
}

/** Is a tile of this kind hidden by the filters? */
export function isFilteredOut(kind: 'meeting' | 'blocked' | 'task' | 'habit', filters: PlannerFilters): boolean {
  return kind === 'meeting' || kind === 'blocked' ? !filters.meetings : !filters.movable;
}
