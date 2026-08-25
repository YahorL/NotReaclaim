import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import { pickCurrentOrNext } from './currentOrNext';

const NOW = Date.parse('2026-06-11T12:00:00Z');

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null, startedAt: null,
    ...over,
  };
}

describe('pickCurrentOrNext', () => {
  it('ignores blocks that are not task blocks', () => {
    const r = pickCurrentOrNext([block({ taskId: null })], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });

  it('picks the soonest un-started future task block as next', () => {
    const later = block({ id: 'late', startsAt: '2026-06-11T16:00:00Z', endsAt: '2026-06-11T17:00:00Z' });
    const sooner = block({ id: 'soon', startsAt: '2026-06-11T13:00:00Z', endsAt: '2026-06-11T13:30:00Z' });
    const r = pickCurrentOrNext([later, sooner], NOW);
    expect(r.nextBlock?.id).toBe('soon');
    expect(r.running).toBeNull();
  });

  it('ignores task blocks that already started in the past without being Started', () => {
    const r = pickCurrentOrNext([block({ startsAt: '2026-06-11T10:00:00Z', endsAt: '2026-06-11T11:00:00Z' })], NOW);
    expect(r.nextBlock).toBeNull();
  });

  it('prefers a started, unfinished block and suppresses next', () => {
    const started = block({ id: 'run', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z' });
    const r = pickCurrentOrNext([started, block()], NOW);
    expect(r.running?.id).toBe('run');
    expect(r.nextBlock).toBeNull();
  });

  it('treats a started block whose snapped start is slightly in the future as running', () => {
    const started = block({ id: 'snap', startsAt: '2026-06-11T12:15:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T12:10:00Z' });
    expect(pickCurrentOrNext([started], NOW).running?.id).toBe('snap');
  });

  it('drops a started block whose end has already passed', () => {
    const done = block({ id: 'done', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T09:00:00Z' });
    const r = pickCurrentOrNext([done], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });
});
