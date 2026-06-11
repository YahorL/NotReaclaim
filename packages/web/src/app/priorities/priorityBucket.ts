import type { SchedulePreview } from '../../api/types';

export const BUCKETS = ['critical', 'high', 'medium', 'low'] as const;
export type BucketKey = (typeof BUCKETS)[number];
export type BoardColumnKey = BucketKey | 'backlog' | 'completed';

export function priorityToBucket(priority: number): BucketKey {
  if (priority <= 1) return 'critical';
  if (priority === 2) return 'high';
  if (priority === 3) return 'medium';
  return 'low';
}

export function bucketToPriority(bucket: BucketKey): 1 | 2 | 3 | 4 {
  switch (bucket) {
    case 'critical': return 1;
    case 'high': return 2;
    case 'medium': return 3;
    case 'low': return 4;
  }
}

// Tailwind needs these literal class strings present in source to generate them.
export const BUCKET_META: Record<BucketKey, { label: string; dot: string; leftBorder: string }> = {
  critical: { label: 'Critical', dot: 'bg-crit', leftBorder: 'border-l-crit' },
  high: { label: 'High priority', dot: 'bg-high', leftBorder: 'border-l-high' },
  medium: { label: 'Medium priority', dot: 'bg-med', leftBorder: 'border-l-med' },
  low: { label: 'Low priority', dot: 'bg-low', leftBorder: 'border-l-low' },
};

export const EXTRA_COLUMN_META: Record<'backlog' | 'completed', { label: string; dot: string; leftBorder: string }> = {
  backlog: { label: 'Backlog', dot: 'bg-[#aeb2c0]', leftBorder: 'border-l-[#aeb2c0]' },
  completed: { label: 'Completed', dot: 'bg-low', leftBorder: 'border-l-low' },
};

export function columnMeta(key: BoardColumnKey): { label: string; dot: string; leftBorder: string } {
  if (key === 'backlog' || key === 'completed') return EXTRA_COLUMN_META[key];
  return BUCKET_META[key];
}

function timeLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace(/\s+/g, '')
    .toLowerCase();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function relativeDayTimeLabel(ms: number, now: number): string {
  const d = new Date(ms);
  const diffDays = Math.round((startOfDay(ms) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return `Today ${timeLabel(d)}`;
  if (diffDays === 1) return `Tomorrow ${timeLabel(d)}`;
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(d);
  return `${weekday} ${timeLabel(d)}`;
}

/** Within-bucket display order: user sortOrder, then due date. */
export function sortBucket<T extends { sortOrder: number; dueBy: string }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || Date.parse(a.dueBy) - Date.parse(b.dueBy));
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
