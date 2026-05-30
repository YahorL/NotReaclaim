import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateForEvent } from './events';

function spyClient() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  return { qc, spy };
}

describe('invalidateForEvent', () => {
  it('schedule.updated invalidates the schedule queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'schedule.updated', userId: 'u1', counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('sync.completed invalidates the schedule queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('task.changed invalidates both tasks and schedule', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});
