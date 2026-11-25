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

  it('a 400 names each bad field and why in plain text (the custom messages read naturally)', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` },
      payload: {
        ...settingsBody,
        timezone: 'Fantasia/Castle',
        workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }, { weekday: 2, startMinute: 600, endMinute: 540 }],
        defaultMinChunkMs: 1800001, defaultMaxChunkMs: 1800000,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: 'validation_error',
      message: 'timezone: must be a valid IANA time zone; workingHours.1: startMinute must be before endMinute; '
        + 'defaultMinChunkMs: must not exceed defaultMaxChunkMs',
    });
  });

  it('a 400 for the chunk-order rule reads naturally', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const res = await app.inject({
      method: 'PUT', url: '/settings', headers: { authorization: `Bearer ${token}` },
      payload: { ...settingsBody, defaultMinChunkMs: 1800001, defaultMaxChunkMs: 1800000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('defaultMinChunkMs: must not exceed defaultMaxChunkMs');
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

  it('rejects defaultMinChunkMs > defaultMaxChunkMs with 400 and accepts equal values', async () => {
    const { app, reconcileCalls } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const bad = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, defaultMinChunkMs: 1800001, defaultMaxChunkMs: 1800000 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('validation_error');
    expect(reconcileCalls).toEqual([]);
    const equal = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, defaultMinChunkMs: 1800000, defaultMaxChunkMs: 1800000 } });
    expect(equal.statusCode).toBe(200);
  });

  // Same per-window rules as the category routes: core silently shifts an out-of-range minute
  // into a neighbouring day and silently drops an empty/inverted window.
  it('rejects working-hour windows the category routes reject, and stores nothing', async () => {
    const { app, reconcileCalls } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const cases = {
      'startMinute -60': { weekday: 1, startMinute: -60, endMinute: 1020 },
      'endMinute 1500': { weekday: 1, startMinute: 540, endMinute: 1500 },
      'start == end': { weekday: 1, startMinute: 540, endMinute: 540 },
      'start > end': { weekday: 1, startMinute: 1020, endMinute: 540 },
    };
    for (const [label, window] of Object.entries(cases)) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, workingHours: [window] } });
      expect(res.statusCode, label).toBe(400);
      expect(res.json().code, label).toBe('validation_error');
    }
    expect(reconcileCalls).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).statusCode).toBe(404);
  });

  it('still accepts an empty week, the new-user defaults, and 0..1439 / full-day 0..1440 windows', async () => {
    const { app } = buildTestApp({ settings: null });
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const defaults = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 })); // ensureUserDefaults
    const shapes = {
      'empty week': [],
      'ensureUserDefaults': defaults,
      '00:00-23:59': [{ weekday: 0, startMinute: 0, endMinute: 1439 }],
      'full day': [{ weekday: 6, startMinute: 0, endMinute: 1440 }],
    };
    for (const [label, workingHours] of Object.entries(shapes)) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, workingHours } });
      expect(res.statusCode, label).toBe(200);
      expect(res.json().workingHours, label).toEqual(workingHours);
    }
  });
});
