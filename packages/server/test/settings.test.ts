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

  it('PUT /settings round-trips requireStartToTrack', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const put = await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` },
      payload: {
        timezone: 'UTC', workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
        defaultMinChunkMs: 1800000, defaultMaxChunkMs: 3600000, requireStartToTrack: true,
      },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().requireStartToTrack).toBe(true);
  });

  it('PUT /settings round-trips dayStartMinute', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const put = await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` },
      payload: { ...settingsBody, dayStartMinute: 180 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().dayStartMinute).toBe(180);
  });

  it('rejects an out-of-range dayStartMinute with 400', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    for (const dayStartMinute of [1440, -1, 12.5]) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, dayStartMinute } });
      expect(res.statusCode).toBe(400);
    }
    const ok = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, dayStartMinute: 1439 } });
    expect(ok.statusCode).toBe(200);
  });

  it('rejects a timezone that is not a valid IANA zone with 400 and stores nothing', async () => {
    const { app, reconcileCalls } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    // "local"/"system" would silently mean the server's own zone; "+03:00" is a fixed offset.
    for (const timezone of ['New York', 'Fantasia/Castle', 'local', 'system', '+03:00', '']) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, timezone } });
      expect(res.statusCode, timezone).toBe(400);
      expect(res.json().code).toBe('validation_error');
    }
    expect(reconcileCalls).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).statusCode).toBe(404);
  });

  it('accepts canonical and legacy-alias IANA zones', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    for (const timezone of ['UTC', 'Etc/GMT+5', 'Asia/Calcutta', 'Europe/Kiev', 'US/Pacific', 'GMT']) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, timezone } });
      expect(res.statusCode, timezone).toBe(200);
    }
  });
});
