/** Buffer stepper increment (minutes). */
export const BUFFER_STEP_MIN = 5;

const clean = (min: number): number => (Number.isFinite(min) && min > 0 ? min : 0);

/**
 * One − / + press on a buffer, in minutes: moves to the next multiple of 5 in that direction
 * (7 → 10 / 5), floors at 0, no upper clamp (spec §9 — the design's 0–60 clamp is not adopted).
 * An invalid field value (negative, NaN) restarts from 0.
 */
export function stepBuffer(min: number, dir: 1 | -1): number {
  const v = clean(min);
  const S = BUFFER_STEP_MIN;
  const next = dir === 1 ? Math.floor(v / S) * S + S : Math.ceil(v / S) * S - S;
  return Math.max(0, next);
}

export type PreviewKind = 'buffer' | 'meeting' | 'task' | 'gap';
export interface PreviewSegment { kind: PreviewKind; minutes: number; pct: number }

const MEETING_MIN = 60;
const TASK_MIN = 30;

/**
 * The Buffers preview strip ("how an afternoon gets laid out"): buffer · 60-min meeting · buffer ·
 * 30-min task · gap · 30-min task, each sized by its share of the strip's total minutes — so the
 * widths stay inside the strip at any buffer size (no upper clamp).
 */
export function bufferPreview(meetingBufferMin: number, gapMin: number): PreviewSegment[] {
  const b = clean(meetingBufferMin);
  const g = clean(gapMin);
  const parts: { kind: PreviewKind; minutes: number }[] = [
    { kind: 'buffer', minutes: b },
    { kind: 'meeting', minutes: MEETING_MIN },
    { kind: 'buffer', minutes: b },
    { kind: 'task', minutes: TASK_MIN },
    { kind: 'gap', minutes: g },
    { kind: 'task', minutes: TASK_MIN },
  ];
  const total = parts.reduce((a, p) => a + p.minutes, 0);
  return parts.map((p) => ({ ...p, pct: (p.minutes / total) * 100 }));
}
