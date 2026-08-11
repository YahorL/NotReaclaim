import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleClient } from '../src/google-client.js';
import { GoogleApiError } from '../src/errors.js';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/cal%20one/events/g%3A1';

const client = createGoogleClient({ clientId: 'cid', clientSecret: 'secret' });
const write = {
  summary: 'Renamed',
  startDateTime: '2026-01-05T14:00:00.000Z',
  endDateTime: '2026-01-05T15:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;
const realFetch = globalThis.fetch;

function lastCall() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
}

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('googleClient.patchEvent', () => {
  it('PATCHes the event so unspecified Google-side fields are preserved', async () => {
    await client.patchEvent('at-1', 'cal one', 'g:1', write);
    const call = lastCall();
    expect(call.url).toBe(EVENTS_URL);
    expect(call.method).toBe('PATCH');
    expect(call.headers.Authorization).toBe('Bearer at-1');
    expect(call.body).toEqual({
      summary: 'Renamed',
      start: { dateTime: '2026-01-05T14:00:00.000Z' },
      end: { dateTime: '2026-01-05T15:00:00.000Z' },
    });
  });

  it('throws GoogleApiError on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 403 }));
    await expect(client.patchEvent('at-1', 'cal one', 'g:1', write)).rejects.toBeInstanceOf(GoogleApiError);
  });
});

describe('googleClient.updateEvent', () => {
  it('still PUTs (full replace) — used for wholly app-owned scheduled blocks', async () => {
    await client.updateEvent('at-1', 'cal one', 'g:1', write);
    const call = lastCall();
    expect(call.url).toBe(EVENTS_URL);
    expect(call.method).toBe('PUT');
  });
});
