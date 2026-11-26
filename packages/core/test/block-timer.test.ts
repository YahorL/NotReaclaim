import { describe, it, expect } from 'vitest';
import { exactStartMs, startBlockPatch, stopBlockEndMs } from '../src/block-timer.js';

const at = (hm: string) => Date.parse(`2026-01-05T${hm}:00.000Z`);

describe('startBlockPatch', () => {
  describe('the block has begun (startsAt <= now): the start is pulled to round15(now), the end is kept', () => {
    it('a running block: pulls the start to round15(now), stamps the raw now, pins', () => {
      // 10:08 rounds to 10:15, still before the 11:00 end.
      expect(startBlockPatch(at('09:00'), at('11:00'), at('10:08'))).toStrictEqual({
        pinned: true, startedAt: new Date(at('10:08')), startsAt: new Date(at('10:15')),
      });
    });

    it('rounds to the NEAREST quarter (10:07 → 10:00)', () => {
      expect(startBlockPatch(at('09:00'), at('11:00'), at('10:07')).startsAt).toEqual(new Date(at('10:00')));
    });

    it('now exactly at the start counts as begun: round15 may pull the start EARLIER, the end is still kept', () => {
      // A 5-minute-grid start: 09:05 rounds to 09:00, so the block grows by 5 minutes.
      expect(startBlockPatch(at('09:05'), at('10:05'), at('09:05'))).toStrictEqual({
        pinned: true, startedAt: new Date(at('09:05')), startsAt: new Date(at('09:00')),
      });
    });

    it('round15(now) exactly at the end: the start is left alone (no startsAt key)', () => {
      expect(startBlockPatch(at('10:00'), at('10:15'), at('10:08'))).toStrictEqual({ pinned: true, startedAt: new Date(at('10:08')) });
    });

    it('a block that already ended: the start is left alone (no startsAt key)', () => {
      expect(startBlockPatch(at('09:00'), at('09:30'), at('10:00'))).toStrictEqual({ pinned: true, startedAt: new Date(at('10:00')) });
    });
  });

  describe('Start pressed before the block (now < startsAt): the block moves to round15(now) and keeps its length', () => {
    it('a later block today moves to now', () => {
      expect(startBlockPatch(at('14:00'), at('15:30'), at('10:00'))).toStrictEqual({
        pinned: true, startedAt: new Date(at('10:00')), startsAt: new Date(at('10:00')), endsAt: new Date(at('11:30')),
      });
    });

    it('a block on another day moves to now too (it no longer runs until that far end)', () => {
      const tomorrow = Date.parse('2026-01-06T09:00:00.000Z');
      expect(startBlockPatch(tomorrow, tomorrow + 3_600_000, at('10:08'))).toStrictEqual({
        pinned: true, startedAt: new Date(at('10:08')), startsAt: new Date(at('10:15')), endsAt: new Date(at('11:15')),
      });
    });

    it('round15(now) landing AFTER the planned start (09:08 → 09:15, block at 09:10): the block keeps its times', () => {
      // Moving to round15(now) would push it later than planned; it is about to begin anyway.
      expect(startBlockPatch(at('09:10'), at('10:10'), at('09:08'))).toStrictEqual({ pinned: true, startedAt: new Date(at('09:08')) });
    });

    it('round15(now) equal to the planned start: the block keeps its times', () => {
      expect(startBlockPatch(at('09:00'), at('10:00'), at('08:55'))).toStrictEqual({ pinned: true, startedAt: new Date(at('08:55')) });
    });

    it('the moved block is not clamped against what follows it (the replan plans around a started block)', () => {
      // 10:00–11:00 started at 08:20 → 08:15–09:15, whatever sits at 09:00.
      expect(startBlockPatch(at('10:00'), at('11:00'), at('08:20'))).toMatchObject({
        startsAt: new Date(at('08:15')), endsAt: new Date(at('09:15')),
      });
    });
  });
});

describe('startBlockPatch never moves a block back over time that already counted (recentEnds)', () => {
  it('early Start: the new start is clamped to the latest end in (candidate, now], keeping the length', () => {
    // 10-minute buffer layout: 11:20–12:20 has ended, 12:30–13:30 next, Start at 12:21 (round15 = 12:15).
    expect(startBlockPatch(at('12:30'), at('13:30'), at('12:21'), [at('12:20')])).toMatchObject({
      startsAt: new Date(at('12:20')), endsAt: new Date(at('13:20')),
    });
    // An off-grid end: 09:05–10:05 ended, Start at 10:06 on 10:15–11:15 (round15 = 10:00).
    expect(startBlockPatch(at('10:15'), at('11:15'), at('10:06'), [at('10:05'), at('09:30')])).toMatchObject({
      startsAt: new Date(at('10:05')), endsAt: new Date(at('11:05')),
    });
  });

  it('an end at or before the candidate start does not move it', () => {
    expect(startBlockPatch(at('12:30'), at('13:30'), at('12:21'), [at('12:15'), at('12:10')])).toMatchObject({
      startsAt: new Date(at('12:15')), endsAt: new Date(at('13:15')),
    });
  });

  it('begun block whose snapped start moves EARLIER: clamped too, the end is kept; never later than its own start', () => {
    // Off-grid 09:05–10:05, Start at 09:06 (round15 = 09:00), another piece ended 09:04.
    expect(startBlockPatch(at('09:05'), at('10:05'), at('09:06'), [at('09:04')])).toStrictEqual({
      pinned: true, startedAt: new Date(at('09:06')), startsAt: new Date(at('09:04')),
    });
    expect(startBlockPatch(at('09:05'), at('10:05'), at('09:06'), [at('09:05') + 30_000]).startsAt).toEqual(new Date(at('09:05')));
  });

  it('a begun block whose start moves LATER (it shrinks) is not affected', () => {
    expect(startBlockPatch(at('09:00'), at('11:00'), at('10:08'), [at('10:05')]).startsAt).toEqual(new Date(at('10:15')));
  });
});

describe('startBlockPatch from an exact start (the 5th argument replaces round15(now))', () => {
  it('early Start: the block moves to the exact start and keeps its length', () => {
    // Hand-placed 09:15–10:15 running, Start at 09:17:40 on 11:00–12:00 → 09:17–10:17, not 09:15–10:15.
    expect(startBlockPatch(at('11:00'), at('12:00'), at('09:17') + 40_000, [], at('09:17'))).toStrictEqual({
      pinned: true, startedAt: new Date(at('09:17') + 40_000), startsAt: new Date(at('09:17')), endsAt: new Date(at('10:17')),
    });
  });

  it('begun block: the start is pulled to the exact start, the end is kept', () => {
    expect(startBlockPatch(at('09:00'), at('10:00'), at('09:17') + 40_000, [], at('09:17'))).toStrictEqual({
      pinned: true, startedAt: new Date(at('09:17') + 40_000), startsAt: new Date(at('09:17')),
    });
    // Begun within the current minute: pulled EARLIER to the exact start (it grows by the seconds).
    expect(startBlockPatch(at('09:17') + 30_000, at('10:00'), at('09:17') + 40_000, [], at('09:17')).startsAt).toEqual(new Date(at('09:17')));
  });

  it('the recentEnds clamp still holds it back: the start is the later of the exact start and the latest counted end', () => {
    expect(startBlockPatch(at('11:00'), at('12:00'), at('09:17') + 40_000, [at('09:17') + 20_000], at('09:17'))).toMatchObject({
      startsAt: new Date(at('09:17') + 20_000), endsAt: new Date(at('10:17') + 20_000),
    });
    // An end at or before the exact start does not move it (from round15 = 09:15, this 09:16 would).
    expect(startBlockPatch(at('11:00'), at('12:00'), at('09:17') + 40_000, [at('09:16')], at('09:17')).startsAt).toEqual(new Date(at('09:17')));
  });

  it('a begun block that has already ended at the exact start keeps its times (no startsAt key)', () => {
    expect(startBlockPatch(at('09:00'), at('09:17'), at('09:17') + 40_000, [], at('09:17'))).toStrictEqual({
      pinned: true, startedAt: new Date(at('09:17') + 40_000),
    });
  });
});

describe('exactStartMs: where Start begins a block when a hand-placed running block would otherwise be left whole beside it', () => {
  it('no such block: null (Start keeps round15)', () => {
    expect(exactStartMs(at('09:17'), [])).toBeNull();
  });

  it('the current minute, truncated, when every such block began before it', () => {
    expect(exactStartMs(at('09:17') + 40_000, [at('09:15')])).toBe(at('09:17'));
    expect(exactStartMs(at('09:17'), [at('09:15'), at('09:16')])).toBe(at('09:17'));
  });

  it('pressed within the minute such a block began: the raw instant (seconds and all)', () => {
    expect(exactStartMs(at('09:15') + 40_000, [at('09:15')])).toBe(at('09:15') + 40_000);
    expect(exactStartMs(at('09:17') + 40_000, [at('09:15'), at('09:17') + 10_000])).toBe(at('09:17') + 40_000);
  });

  it('every such block began at this very instant: null (nothing can be cut, Start keeps round15)', () => {
    expect(exactStartMs(at('09:17'), [at('09:17')])).toBeNull();
  });

  it('some began at this very instant, others before: chosen for the others alone (the ones begun now are left whole)', () => {
    expect(exactStartMs(at('09:17') + 40_000, [at('09:16'), at('09:17') + 40_000])).toBe(at('09:17'));
    expect(exactStartMs(at('09:17') + 40_000, [at('09:17') + 10_000, at('09:17') + 40_000])).toBe(at('09:17') + 40_000);
  });
});

describe('stopBlockEndMs', () => {
  it('ends at round15(now) inside the block', () => {
    expect(stopBlockEndMs(at('09:00'), at('11:00'), at('10:08'))).toBe(at('10:15'));
  });

  it('never ends before start + 15 min (no zero-length block)', () => {
    expect(stopBlockEndMs(at('10:00'), at('11:00'), at('10:02'))).toBe(at('10:15'));
  });

  it('never ends after the original end (Stop only shortens)', () => {
    expect(stopBlockEndMs(at('09:00'), at('09:30'), at('10:00'))).toBe(at('09:30'));
  });

  it('the original end wins over the start + 15 min floor for a block shorter than 15 min', () => {
    expect(stopBlockEndMs(at('09:00'), at('09:10'), at('08:00'))).toBe(at('09:10'));
  });
});
