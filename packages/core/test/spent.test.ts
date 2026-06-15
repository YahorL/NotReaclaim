import { describe, it, expect } from 'vitest';
import { round15, computeSpentMs } from '../src/spent.js';
import { makeBlock } from './fakes.js';

const NOW = Date.parse('2026-01-05T15:00:00.000Z');
const at = (iso: string) => new Date(`2026-01-05T${iso}:00.000Z`);

describe('round15', () => {
  it('rounds to the nearest 15 minutes', () => {
    expect(round15(Date.parse('2026-01-05T15:10:00.000Z'))).toBe(Date.parse('2026-01-05T15:15:00.000Z'));
    expect(round15(Date.parse('2026-01-05T15:07:00.000Z'))).toBe(Date.parse('2026-01-05T15:00:00.000Z'));
    expect(round15(Date.parse('2026-01-05T15:00:00.000Z'))).toBe(Date.parse('2026-01-05T15:00:00.000Z'));
  });
});

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
