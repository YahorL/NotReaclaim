import type { SchedulePreview } from '../../api/types';

export const BUCKETS = ['critical', 'high', 'medium', 'low'] as const;
export type BucketKey = (typeof BUCKETS)[number];

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

export function nextBlockMsForTask(taskId: string, preview: SchedulePreview | undefined): number | null {
  if (!preview) return null;
  const starts = preview.blocks
    .filter((b) => b.sourceType === 'task' && b.sourceId === taskId)
    .map((b) => b.start);
  return starts.length ? Math.min(...starts) : null;
}
