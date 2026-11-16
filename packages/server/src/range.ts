import { horizonEndMs } from '@notreclaim/core';

/**
 * Resolve a `?from&to` list range: `from` defaults to now, `to` to the end of the user's
 * planning horizon (14 days when no settings exist). The horizon is only looked up when
 * `to` is absent.
 */
export async function resolveRange(
  query: { from?: string; to?: string },
  now: () => number,
  loadHorizonDays: () => Promise<number | undefined>,
): Promise<{ start: Date; end: Date }> {
  const start = query.from ? new Date(query.from) : new Date(now());
  if (query.to) return { start, end: new Date(query.to) };
  const horizonDays = (await loadHorizonDays()) ?? 14;
  return { start, end: new Date(horizonEndMs(now(), horizonDays)) };
}
