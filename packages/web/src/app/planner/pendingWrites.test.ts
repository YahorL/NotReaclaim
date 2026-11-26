import { describe, it, expect } from 'vitest';
import { pendingTileKeys, dropPlaceholdersFrom } from './pendingWrites';

describe('pendingTileKeys', () => {
  it('maps block writes to b:<id> and event writes to e:<id>; creates have no tile yet', () => {
    expect(pendingTileKeys([
      { op: 'blockUpdate', target: 'b1', variables: null },
      { op: 'blockStart', target: 'b2', variables: 'b2' },
      { op: 'blockStop', target: 'b3', variables: 'b3' },
      { op: 'blockDelete', target: 'b4', variables: 'b4' },
      { op: 'eventUpdate', target: 'e1', variables: null },
      { op: 'eventDelete', target: 'e2', variables: 'e2' },
      { op: 'blockCreate', target: 't1', variables: null },
    ])).toEqual(['b:b1', 'b:b2', 'b:b3', 'b:b4', 'e:e1', 'e:e2']);
  });
});

describe('dropPlaceholdersFrom', () => {
  it('one placeholder per pending create, at its slot, titled after its task', () => {
    const v = { taskId: 't1', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' };
    expect(dropPlaceholdersFrom(
      [{ op: 'blockCreate', target: 't1', variables: v }, { op: 'blockStart', target: 'b1', variables: 'b1' }],
      [{ id: 't1', title: 'Inbox zero' }],
    )).toEqual([{ key: 'drop:t1', title: 'Inbox zero', startMs: Date.parse(v.startsAt), endMs: Date.parse(v.endsAt) }]);
  });
});
