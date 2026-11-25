import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { createGoogleClient } from '../src/google-client.js';
import { GoogleApiError, GoogleAuthError, GoogleTimeoutError, SyncTokenExpiredError } from '../src/errors.js';

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/cal%20one/events/g%3A1';

const client = createGoogleClient({ clientId: 'cid', clientSecret: 'secret' });
const write = {
  summary: 'Renamed',
  startDateTime: '2026-01-05T14:00:00.000Z',
  endDateTime: '2026-01-05T15:00:00.000Z',
};

let fetchMock: Mock<Parameters<typeof fetch>, Promise<Response>>;
const realFetch = globalThis.fetch;

function lastCall() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, method: init.method, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) };
}

beforeEach(() => {
  fetchMock = vi.fn<Parameters<typeof fetch>, Promise<Response>>(async () => new Response('{}', { status: 200 }));
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

describe('request timeout', () => {
  const TIMEOUT_MS = 20;
  const quick = createGoogleClient({ clientId: 'cid', clientSecret: 'secret', requestTimeoutMs: TIMEOUT_MS });

  /** A fetch that never answers on its own — like a real one, it rejects once its signal aborts. */
  function hangUntilAborted(_url: unknown, init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no signal = hangs forever (the defect)
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  }

  it('gives up on a hung request after the timeout with a GoogleTimeoutError (a failed Google call)', async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    const err = await quick.listEvents({ accessToken: 'at', calendarId: 'primary', syncToken: 'tok' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleTimeoutError);
    // Callers treat it like any other failed Google call (server: 502), never as a revoked
    // grant ("reconnect" banner) or an expired sync token (full resync).
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).not.toBeInstanceOf(GoogleAuthError);
    expect(err).not.toBeInstanceOf(SyncTokenExpiredError);
    expect((err as Error).message).toContain(`${TIMEOUT_MS} ms`);
  });

  it('a timed-out delete is an error, not the tolerated "already gone" 404/410', async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    await expect(quick.deleteEvent('at', 'cal one', 'g:1')).rejects.toBeInstanceOf(GoogleTimeoutError);
  });

  it('applies to every Calendar call, including writes', async () => {
    fetchMock.mockImplementation(hangUntilAborted);
    await expect(quick.insertEvent('at', 'cal', write)).rejects.toBeInstanceOf(GoogleTimeoutError);
    await expect(quick.patchEvent('at', 'cal', 'g:1', write)).rejects.toBeInstanceOf(GoogleTimeoutError);
    await expect(quick.createCalendar('at', 'NotReclaim')).rejects.toBeInstanceOf(GoogleTimeoutError);
  });

  it('also covers a response whose body stalls after the headers arrive', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init!.signal!;
      const body = new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason)); },
      });
      return new Response(body, { status: 200 });
    });
    await expect(quick.insertEvent('at', 'cal', write)).rejects.toBeInstanceOf(GoogleTimeoutError);
  });

  it('still reports a non-ok answer as GoogleApiError with its real status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 503 }));
    const err = await quick.patchEvent('at', 'cal', 'g:1', write).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoogleApiError);
    expect(err).not.toBeInstanceOf(GoogleTimeoutError);
    expect((err as GoogleApiError).status).toBe(503);
  });

  it('defaults to 15 seconds', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await client.patchEvent('at-1', 'cal one', 'g:1', write);
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });
});
