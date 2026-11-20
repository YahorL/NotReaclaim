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

  it('sync.completed invalidates schedule and calendar-event queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['calendarEvents'] });
  });

  it('google.status invalidates the google-status query', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'google.status', userId: 'u1', broken: true });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['googleStatus'] });
  });

  it('task.changed invalidates both tasks and schedule', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});

describe('invalidateForEvent: data.changed', () => {
  const invalidated = (spy: ReturnType<typeof spyClient>['spy']) => spy.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);

  it.each([
    ['tasks', ['tasks']],
    ['habits', ['habits']],
    ['categories', ['categories']],
    ['settings', ['settings']],
    ['calendarEvents', ['calendarEvents']],
    ['schedule', ['schedule']],
    ['googleStatus', ['googleStatus']],
  ] as const)('resource %s invalidates exactly its own query root', (resource, root) => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'data.changed', userId: 'u1', resources: [resource] });
    expect(invalidated(spy)).toEqual([root]);
  });

  it('invalidates every listed resource, once each, and nothing else', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'data.changed', userId: 'u1', resources: ['schedule', 'tasks'] });
    expect(invalidated(spy)).toEqual([['schedule'], ['tasks']]);
  });

  it('skips resource names it does not know (a newer server) and keeps the known ones', () => {
    const { qc, spy } = spyClient();
    const event = { type: 'data.changed', userId: 'u1', resources: ['someday', 'habits', 'toString'] };
    expect(() => invalidateForEvent(qc, event as never)).not.toThrow();
    expect(invalidated(spy)).toEqual([['habits']]);
  });

  it('tolerates a missing or non-array resources field', () => {
    const { qc, spy } = spyClient();
    expect(() => invalidateForEvent(qc, { type: 'data.changed', userId: 'u1' } as never)).not.toThrow();
    expect(() => invalidateForEvent(qc, { type: 'data.changed', userId: 'u1', resources: 'habits' } as never)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('invalidateForEvent: unknown event types', () => {
  it('ignores an event type it does not know, without throwing', () => {
    const { qc, spy } = spyClient();
    expect(() => invalidateForEvent(qc, { type: 'future.thing', userId: 'u1' } as never)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
});
