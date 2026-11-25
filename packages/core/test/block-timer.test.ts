import { describe, it, expect } from 'vitest';
import { startBlockPatch, stopBlockEndMs } from '../src/block-timer.js';

const at = (hm: string) => Date.parse(`2026-01-05T${hm}:00.000Z`);

describe('startBlockPatch', () => {
  it('a running block: pulls the start to round15(now), stamps the raw now, pins', () => {
    // 10:08 rounds to 10:15, still before the 11:00 end.
    expect(startBlockPatch(at('11:00'), at('10:08'))).toStrictEqual({
      pinned: true, startedAt: new Date(at('10:08')), startsAt: new Date(at('10:15')),
    });
  });

  it('rounds to the NEAREST quarter (10:07 → 10:00)', () => {
    expect(startBlockPatch(at('11:00'), at('10:07')).startsAt).toEqual(new Date(at('10:00')));
  });

  it('a future block is pulled forward to round15(now)', () => {
    // The block's own start (whatever it is) is not an input: only its end matters.
    expect(startBlockPatch(at('14:00'), at('10:00'))).toStrictEqual({
      pinned: true, startedAt: new Date(at('10:00')), startsAt: new Date(at('10:00')),
    });
  });

  it('round15(now) exactly at the end: the start is left alone (no startsAt key)', () => {
    expect(startBlockPatch(at('10:15'), at('10:08'))).toStrictEqual({ pinned: true, startedAt: new Date(at('10:08')) });
  });

  it('a block that already ended: the start is left alone (no startsAt key)', () => {
    expect(startBlockPatch(at('09:30'), at('10:00'))).toStrictEqual({ pinned: true, startedAt: new Date(at('10:00')) });
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
