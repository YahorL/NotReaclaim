import { DateTime } from 'luxon';
import type { SchedulePreview, Task } from '../../api/types';

export const BUCKETS = ['critical', 'high', 'medium', 'low'] as const;
export type BucketKey = (typeof BUCKETS)[number];
export type BoardColumnKey = BucketKey | 'backlog' | 'completed';
/** Every board column, in display order. */
export const BOARD_COLUMNS: readonly BoardColumnKey[] = [...BUCKETS, 'backlog', 'completed'];

export function priorityToBucket(priority: number): BucketKey {
  if (priority <= 1) return 'critical';
  if (priority === 2) return 'high';
  if (priority === 3) return 'medium';
  return 'low';
}

/** A task still waiting to be worked: pending or scheduled (not backlog, not completed). */
export function isActiveTask(task: Pick<Task, 'status'>): boolean {
  return task.status === 'pending' || task.status === 'scheduled';
}

export function bucketToPriority(bucket: BucketKey): 1 | 2 | 3 | 4 {
  switch (bucket) {
    case 'critical': return 1;
    case 'high': return 2;
    case 'medium': return 3;
    case 'low': return 4;
  }
}

/** `dot`: the priority's fill; `glow`: the soft halo the glass column header gives its dot. */
export interface ColumnMeta { label: string; dot: string; glow: string }

// Tailwind needs these literal class strings present in source to generate them.
export const BUCKET_META: Record<BucketKey, ColumnMeta> = {
  critical: { label: 'Critical', dot: 'bg-pri-crit', glow: 'shadow-[0_0_12px_rgb(var(--c-pri-crit))]' },
  high: { label: 'High priority', dot: 'bg-pri-high', glow: 'shadow-[0_0_12px_rgb(var(--c-pri-high))]' },
  medium: { label: 'Medium priority', dot: 'bg-pri-med', glow: 'shadow-[0_0_12px_rgb(var(--c-pri-med))]' },
  low: { label: 'Low priority', dot: 'bg-pri-low', glow: 'shadow-[0_0_12px_rgb(var(--c-pri-low))]' },
};

const EXTRA_COLUMN_META: Record<'backlog' | 'completed', ColumnMeta> = {
  // Backlog is "no priority yet": a neutral dot with no halo.
  backlog: { label: 'Backlog', dot: 'bg-fg-3', glow: '' },
  completed: { label: 'Completed', dot: 'bg-pri-low', glow: 'shadow-[0_0_12px_rgb(var(--c-pri-low))]' },
};

export function columnMeta(key: BoardColumnKey): ColumnMeta {
  if (key === 'backlog' || key === 'completed') return EXTRA_COLUMN_META[key];
  return BUCKET_META[key];
}

function timeLabel(d: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone })
    .format(d)
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** "Today 5:00pm" / "Tomorrow 9:30am" / "Sat 8:15am" — day and time read in `zone`. */
export function relativeDayTimeLabel(ms: number, now: number, zone: string): string {
  const d = new Date(ms);
  const day = (t: number) => DateTime.fromMillis(t, { zone }).startOf('day');
  const diffDays = Math.round(day(ms).diff(day(now), 'days').days);
  if (diffDays === 0) return `Today ${timeLabel(d, zone)}`;
  if (diffDays === 1) return `Tomorrow ${timeLabel(d, zone)}`;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: zone }).format(d);
  return `${weekday} ${timeLabel(d, zone)}`;
}

/** Board card due label: "Due 1/9" (month/day in `zone`), or "No deadline". */
export function dueShort(iso: string | null, zone: string): string {
  if (!iso) return 'No deadline';
  return `Due ${new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', timeZone: zone }).format(new Date(iso))}`;
}

/** Planner panel due label: "Due Jan 9" (in `zone`), or null for an undated task. */
export function dueLabel(iso: string | null, zone: string): string | null {
  if (!iso) return null;
  return `Due ${new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone })}`;
}

/** Within-bucket display order: user sortOrder, then due date. */
// An undated task sorts last within its sortOrder: its due key is `Infinity`, which is
// greater than every real timestamp.
export function sortBucket<T extends { sortOrder: number; dueBy: string | null }>(tasks: T[]): T[] {
  const due = (t: T) => (t.dueBy ? Date.parse(t.dueBy) : Infinity);
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || due(a) - due(b));
}

/** Completed column order: completedAt desc (nulls last). */
export function sortCompleted<T extends { completedAt: string | null }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.completedAt === null && b.completedAt === null) return 0;
    if (a.completedAt === null) return 1;
    if (b.completedAt === null) return -1;
    return Date.parse(b.completedAt) - Date.parse(a.completedAt);
  });
}

/** sortOrder for inserting at `index` into a sorted bucket (midpoint of neighbors). */
export function insertionSortOrder(sorted: Array<{ sortOrder: number }>, index: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.max(0, Math.min(index, sorted.length));
  if (i === 0) return sorted[0]!.sortOrder - 1;
  if (i === sorted.length) return sorted[sorted.length - 1]!.sortOrder + 1;
  return (sorted[i - 1]!.sortOrder + sorted[i]!.sortOrder) / 2;
}

export function nextBlockMsForTask(taskId: string, preview: SchedulePreview | undefined): number | null {
  if (!preview) return null;
  const starts = preview.blocks
    .filter((b) => b.sourceType === 'task' && b.sourceId === taskId)
    .map((b) => b.start);
  return starts.length ? Math.min(...starts) : null;
}
