import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApiClient, ApiError } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('createApiClient', () => {
  it('attaches a bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 't1' }]));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 'jwt-123' });

    const tasks = await api.listTasks();

    expect(tasks).toEqual([{ id: 't1' }]);
    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const [url, init] = calls[0];
    expect(url).toBe('/tasks');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-123' });
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: 'https://consent' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => null });

    await api.getConsentUrl();

    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const headers = (calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('maps a non-2xx {code,message} body to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'not_found', message: 'Task x not found' }, 404)));
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await expect(api.deleteTask('x')).rejects.toMatchObject({ name: 'ApiError', status: 404, code: 'not_found' });
    expect(await api.getSettings().catch((e) => e)).toBeInstanceOf(ApiError);
  });

  it('sends a JSON body with Content-Type on writes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 't1', title: 'A' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await api.createTask({ title: 'A', priority: 1, durationMs: 1, dueBy: '2026-01-01T00:00:00.000Z', minChunkMs: 1, maxChunkMs: 1 });

    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const init = calls[0][1];
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'A' });
  });

  it('getCalendarEvents builds the range query string', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 'e1', title: 'Standup' }]));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await api.getCalendarEvents('2026-01-05T00:00:00.000Z', '2026-01-12T00:00:00.000Z');

    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    expect(calls[0][0]).toBe('/calendar/events?from=2026-01-05T00%3A00%3A00.000Z&to=2026-01-12T00%3A00%3A00.000Z');
  });

  it('updateScheduledBlock sends a PATCH to /schedule/:id with the patch body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'b1', pinned: true }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await api.updateScheduledBlock('b1', { pinned: true });

    const calls = fetchMock.mock.calls as unknown as [[string, RequestInit]];
    const [url, init] = calls[0];
    expect(url).toBe('/schedule/b1');
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ pinned: true });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });
});
