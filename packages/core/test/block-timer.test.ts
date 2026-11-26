import { describe, it, expect } from 'vitest';
import { startBlockPatch, stopBlockEndMs } from '../src/block-timer.js';

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
