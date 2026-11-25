import { describe, it, expect } from 'vitest';
import { newBlockIds, dropInDelays, dropInDuration, DROP_STAGGER_MS, LAND_MS } from './replanDiff';

const b = (id: string, startsAt: string) => ({ id, startsAt });

describe('newBlockIds', () => {
  it('returns the ids that were not there before', () => {
    const after = [b('a', '2026-01-05T09:00:00Z'), b('b', '2026-01-05T10:00:00Z'), b('c', '2026-01-05T11:00:00Z')];
    expect(newBlockIds(new Set(['a', 'c']), after)).toEqual(new Set(['b']));
  });

  it('a block that moved but kept its id is not new (it glides instead)', () => {
    expect(newBlockIds(new Set(['a']), [b('a', '2026-01-06T09:00:00Z')])).toEqual(new Set());
  });

  it('nothing before → everything is new; nothing after → nothing is', () => {
    expect(newBlockIds(new Set(), [b('a', '2026-01-05T09:00:00Z')])).toEqual(new Set(['a']));
    expect(newBlockIds(new Set(['a']), [])).toEqual(new Set());
  });

  it('can be limited to the visible range (start inside [from, to))', () => {
    const range = { fromMs: Date.parse('2026-01-05T00:00:00Z'), toMs: Date.parse('2026-01-06T00:00:00Z') };
    const after = [b('in', '2026-01-05T23:45:00Z'), b('edge', '2026-01-06T00:00:00Z'), b('before', '2026-01-04T23:00:00Z')];
    expect(newBlockIds(new Set(), after, range)).toEqual(new Set(['in']));
  });
});

describe('dropInDelays', () => {
  it('staggers the new blocks 180ms apart by start time', () => {
    const blocks = [b('late', '2026-01-05T15:00:00Z'), b('old', '2026-01-05T08:00:00Z'), b('early', '2026-01-05T09:00:00Z'), b('mid', '2026-01-05T12:00:00Z')];
    const d = dropInDelays(new Set(['late', 'early', 'mid']), blocks);
    expect([...d.entries()]).toEqual([['early', 0], ['mid', DROP_STAGGER_MS], ['late', 2 * DROP_STAGGER_MS]]);
  });

  it('breaks start-time ties by id (stable across refetches)', () => {
    const d = dropInDelays(new Set(['y', 'x']), [b('y', '2026-01-05T09:00:00Z'), b('x', '2026-01-05T09:00:00Z')]);
    expect([...d.keys()]).toEqual(['x', 'y']);
  });
});

describe('dropInDuration', () => {
  it('is the last delay plus one landing', () => {
    expect(dropInDuration(new Map([['a', 0], ['b', 360]]))).toBe(360 + LAND_MS);
    expect(dropInDuration(new Map())).toBe(0);
  });
});
