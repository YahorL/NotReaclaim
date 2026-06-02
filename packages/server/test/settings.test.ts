import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const settingsBody = {
  timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000,
};

describe('settings routes', () => {
  it('404 before configured, then upsert + get', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: settingsBody });
    expect(put.statusCode).toBe(200);
    expect(put.json().timezone).toBe('America/New_York');
    const got = await app.inject({ method: 'GET', url: '/settings', headers: auth });
    expect(got.statusCode).toBe(200);
  });

  it('triggers a re-plan on settings upsert', async () => {
    const { app, reconcileCalls, emitted } = buildTestApp();
    const token = await tokenFor(app);
    await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` }, payload: settingsBody,
    });

    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
    expect(emitted.some((e) => e.type === 'task.changed')).toBe(false);
  });

  it('persists buffer settings', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PUT', url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...settingsBody, meetingBufferMs: 900000, taskBufferMs: 600000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ meetingBufferMs: 900000, taskBufferMs: 600000 });
  });

  it('rejects a negative buffer with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PUT', url: '/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...settingsBody, meetingBufferMs: -1 },
    });
    expect(res.statusCode).toBe(400);
  });
});
