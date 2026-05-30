import { describe, it, expect } from 'vitest';
import { createConnectionRegistry, type Client } from '../src/connection-registry.js';
import type { ServerEvent } from '../src/events.js';

const event: ServerEvent = { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' };

function fakeClient(userId: string): Client & { sent: string[] } {
  const sent: string[] = [];
  return { userId, sent, send: (data) => sent.push(data) };
}

describe('ConnectionRegistry', () => {
  it('forwards only to clients of the event userId, serialized as JSON', () => {
    const reg = createConnectionRegistry();
    const a = fakeClient('u1');
    const b = fakeClient('u2');
    reg.add(a);
    reg.add(b);

    reg.forward(event);

    expect(a.sent).toEqual([JSON.stringify(event)]);
    expect(b.sent).toEqual([]);
  });

  it('stops sending after remove', () => {
    const reg = createConnectionRegistry();
    const a = fakeClient('u1');
    reg.add(a);
    reg.remove(a);

    reg.forward(event);

    expect(a.sent).toEqual([]);
    expect(reg.countForUser('u1')).toBe(0);
  });

  it('removes a client whose send throws and still delivers to others', () => {
    const reg = createConnectionRegistry();
    const bad: Client = {
      userId: 'u1',
      send: () => {
        throw new Error('dead socket');
      },
    };
    const good = fakeClient('u1');
    reg.add(bad);
    reg.add(good);

    reg.forward(event);

    expect(good.sent).toEqual([JSON.stringify(event)]);
    expect(reg.countForUser('u1')).toBe(1);
  });
});
