import { describe, it, expect } from 'vitest';
import { computeSpentMs, isDiscardableUnstarted } from '../src/spent.js';
import { makeBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T15:00:00.000Z');
const at = (iso: string) => new Date(`2026-01-05T${iso}:00.000Z`);

describe('computeSpentMs', () => {
  const finished = makeBlock({ id: 'f', taskId: 't1', startsAt: at('13:00'), endsAt: at('14:00') }); // 1h, ended
  const inProgress = makeBlock({ id: 'p', taskId: 't1', startsAt: at('14:30'), endsAt: at('15:30') }); // not finished
  const otherTask = makeBlock({ id: 'o', taskId: 't2', startsAt: at('09:00'), endsAt: at('10:00') });

  it('auto mode sums finished blocks for the task only', () => {
    expect(computeSpentMs('t1', [finished, inProgress, otherTask], false, NOW)).toBe(3_600_000);
  });

  it('manual mode counts only finished blocks that were started', () => {
    const startedFinished = makeBlock({ id: 's', taskId: 't1', startsAt: at('11:00'), endsAt: at('12:00'), startedAt: at('11:00') });
    expect(computeSpentMs('t1', [finished, startedFinished], true, NOW)).toBe(3_600_000); // only the started one
  });

  it('returns 0 when nothing qualifies', () => {
    expect(computeSpentMs('t1', [inProgress], false, NOW)).toBe(0);
  });
});

describe('isDiscardableUnstarted', () => {
  const ended = { taskId: 't1', startedAt: null, endsAt: at('14:00') };

  it('an un-started task block that ended before now is discarded', () => {
    expect(isDiscardableUnstarted(ended, NOW)).toBe(true);
  });

  it('one that ends exactly at now is discarded too', () => {
    expect(isDiscardableUnstarted({ ...ended, endsAt: at('15:00') }, NOW)).toBe(true);
  });

  it('one that ends after now is kept', () => {
    expect(isDiscardableUnstarted({ ...ended, endsAt: at('15:30') }, NOW)).toBe(false);
  });

  it('a started block is kept (it counts as spent time)', () => {
    expect(isDiscardableUnstarted({ ...ended, startedAt: at('13:30') }, NOW)).toBe(false);
  });

  it('a habit block (no taskId) is kept', () => {
    expect(isDiscardableUnstarted({ ...ended, taskId: null }, NOW)).toBe(false);
  });

  it('taskId is tested for truthiness: an empty one is kept', () => {
    expect(isDiscardableUnstarted({ ...ended, taskId: '' }, NOW)).toBe(false);
  });
});
