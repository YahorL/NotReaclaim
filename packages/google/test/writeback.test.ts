import { describe, it, expect } from 'vitest';
import { toGoogleEventWrite } from '../src/writeback.js';

describe('toGoogleEventWrite', () => {
  it('maps an engine block to a Google event write payload (ISO times)', () => {
    expect(
      toGoogleEventWrite({
        id: 'task:t1:0', sourceType: 'task', sourceId: 't1', title: 'Focus',
        start: Date.parse('2026-01-05T09:00:00.000Z'), end: Date.parse('2026-01-05T09:30:00.000Z'),
      }),
    ).toEqual({
      summary: 'Focus',
      startDateTime: '2026-01-05T09:00:00.000Z',
      endDateTime: '2026-01-05T09:30:00.000Z',
    });
  });
});
