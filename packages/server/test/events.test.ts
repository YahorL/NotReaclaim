import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../src/events.js';

const COUNTS = { created: 0, updated: 0, deleted: 0, pinned: 0, removed: 0 };

describe('EventBus', () => {
  it('delivers an emitted event to all subscribers', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    const event = { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' } as const;
    bus.emit(event);

    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
  });

  it('stops delivery after unsubscribe', () => {
    const bus = createEventBus();
    const a = vi.fn();
    const off = bus.subscribe(a);
    off();

    bus.emit({ type: 'schedule.updated', userId: 'u1', counts: COUNTS });

    expect(a).not.toHaveBeenCalled();
  });

  it('a throwing listener does not block delivery to others', () => {
    const bus = createEventBus();
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(good);

    expect(() => bus.emit({ type: 'schedule.updated', userId: 'u1', counts: COUNTS })).not.toThrow();
    expect(good).toHaveBeenCalled();
  });
});
