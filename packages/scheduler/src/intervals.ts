import type { Interval } from './types.js';

/** Sort, drop empty intervals, and merge overlapping or touching ones. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const result: Interval[] = [];
  for (const cur of valid) {
    const last = result[result.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      result.push({ start: cur.start, end: cur.end });
    }
  }
  return result;
}

/** Return the portions of `base` not covered by any interval in `busy`. */
export function subtractIntervals(base: Interval[], busy: Interval[]): Interval[] {
  const mergedBase = mergeIntervals(base);
  const mergedBusy = mergeIntervals(busy);
  const result: Interval[] = [];

  for (const b of mergedBase) {
    let cursor = b.start;
    for (const x of mergedBusy) {
      if (x.end <= cursor || x.start >= b.end) continue;
      if (x.start > cursor) {
        result.push({ start: cursor, end: Math.min(x.start, b.end) });
      }
      cursor = Math.max(cursor, x.end);
      if (cursor >= b.end) break;
    }
    if (cursor < b.end) result.push({ start: cursor, end: b.end });
  }
  return result.filter((i) => i.end > i.start);
}

/** Return the overlapping regions between `a` and `b`. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const result: Interval[] = [];
  let i = 0;
  let j = 0;

  while (i < A.length && j < B.length) {
    const ai = A[i]!;
    const bj = B[j]!;
    const start = Math.max(ai.start, bj.start);
    const end = Math.min(ai.end, bj.end);
    if (end > start) result.push({ start, end });
    if (ai.end < bj.end) i++;
    else j++;
  }
  return result;
}
