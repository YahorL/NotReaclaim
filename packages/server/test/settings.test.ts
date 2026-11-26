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

  it('accepts buffers of 0 and exactly 24 h, rejects anything above 24 h (the column is a 32-bit int)', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const DAY = 24 * 60 * 60_000;
    for (const ms of [0, DAY]) {
      const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, meetingBufferMs: ms, taskBufferMs: ms } });
      expect(res.statusCode, String(ms)).toBe(200);
    }
    for (const field of ['meetingBufferMs', 'taskBufferMs']) {
      for (const ms of [DAY + 1, 2 ** 31]) {
        const res = await app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, [field]: ms } });
        expect(res.statusCode, `${field}=${ms}`).toBe(400);
        expect(res.json().message).toBe(`${field}: must be at most 24 hours`);
      }
    }
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

  describe('PATCH /settings (partial update)', () => {
    const stored = {
      id: 'settings-1', userId: 'u1', timezone: 'America/New_York',
      workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
      horizonDays: 21, defaultMinChunkMs: 900000, defaultMaxChunkMs: 1800000,
      meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: true, dayStartMinute: 180,
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const setup = async (settings: typeof stored | null = stored) => {
      const ctx = buildTestApp({ settings: settings as never });
      return { ...ctx, auth: { authorization: `Bearer ${await tokenFor(ctx.app)}` } };
    };

    it('changes only the fields sent and returns the full row', async () => {
      const { app, auth } = await setup();
      const res = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { meetingBufferMs: 900000, taskBufferMs: 600000 } });
      expect(res.statusCode).toBe(200);
      const { createdAt: _c, updatedAt: _u, ...rest } = stored;
      expect(res.json()).toMatchObject({ ...rest, meetingBufferMs: 900000, taskBufferMs: 600000 });
      const got = (await app.inject({ method: 'GET', url: '/settings', headers: auth })).json();
      expect(got).toMatchObject({ ...rest, meetingBufferMs: 900000, taskBufferMs: 600000 });
    });

    it('announces and re-plans exactly like PUT', async () => {
      const { app, auth, reconcileCalls, emitted } = await setup();
      await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { taskBufferMs: 600000 } });
      expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
      expect(emitted).toContainEqual(expect.objectContaining({ type: 'data.changed', userId: 'u1', resources: ['settings', 'tasks', 'schedule'] }));
    });

    it('validates each field it is sent with the PUT rules', async () => {
      const { app, auth, reconcileCalls } = await setup();
      for (const payload of [
        { taskBufferMs: -1 }, { meetingBufferMs: 24 * 60 * 60_000 + 1 }, { timezone: 'Fantasia/Castle' },
        { workingHours: [{ weekday: 1, startMinute: 600, endMinute: 540 }] }, { dayStartMinute: 1440 },
      ]) {
        const res = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload });
        expect(res.statusCode, JSON.stringify(payload)).toBe(400);
        expect(res.json().code).toBe('validation_error');
      }
      expect(reconcileCalls).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).json()).toMatchObject({ taskBufferMs: 0, timezone: 'America/New_York' });
    });

    it('rejects an empty patch', async () => {
      const { app, auth } = await setup();
      const res = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: {} });
      expect(res.statusCode).toBe(400);
    });

    it('checks one chunk default against the stored other one', async () => {
      const { app, auth } = await setup(); // stored min 15 min, max 30 min
      const minOnly = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { defaultMinChunkMs: 2700000 } });
      expect(minOnly.statusCode).toBe(400);
      expect(minOnly.json().message).toBe('defaultMinChunkMs: must not exceed defaultMaxChunkMs');
      const maxOnly = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { defaultMaxChunkMs: 600000 } });
      expect(maxOnly.statusCode).toBe(400);
      const both = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { defaultMinChunkMs: 2700000, defaultMaxChunkMs: 3600000 } });
      expect(both.statusCode).toBe(200);
      expect(both.json()).toMatchObject({ defaultMinChunkMs: 2700000, defaultMaxChunkMs: 3600000 });
    });

    // A row stored before validation existed (e.g. an invalid zone) must not block saving buffers.
    it('does not re-validate stored fields it was not sent', async () => {
      const { app, auth } = await setup({ ...stored, timezone: 'Not/AZone' });
      const res = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { taskBufferMs: 300000 } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ timezone: 'Not/AZone', taskBufferMs: 300000 });
    });

    it('404s when the user has no settings yet, and creates nothing', async () => {
      const { app, auth, reconcileCalls } = await setup(null);
      for (const payload of [{ taskBufferMs: 300000 }, { defaultMinChunkMs: 900000 }]) {
        const res = await app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ code: 'not_found', message: 'Settings not configured' });
      }
      expect(reconcileCalls).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/settings', headers: auth })).statusCode).toBe(404);
    });

    it('requires a token', async () => {
      const { app } = await setup();
      expect((await app.inject({ method: 'PATCH', url: '/settings', payload: { taskBufferMs: 0 } })).statusCode).toBe(401);
    });
  });
});

describe('requireStartSince follows requireStartToTrack (server clock, never from the client, never sent back)', () => {
  const T1 = Date.parse('2026-01-05T10:00:00.000Z');
  const T2 = Date.parse('2026-01-06T10:00:00.000Z');
  async function setup() {
    let clock = T1;
    const ctx = buildTestApp({ now: () => clock });
    const token = await tokenFor(ctx.app);
    const auth = { authorization: `Bearer ${token}` };
    const put = (body: Record<string, unknown>) => ctx.app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...settingsBody, ...body } });
    const patch = (body: Record<string, unknown>) => ctx.app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: body });
    const since = async () => (await ctx.settings.getByUserId('u1'))?.requireStartSince ?? null;
    return { ctx, put, patch, since, auth, at: (t: number) => { clock = t; } };
  }

  it('set on false → true, unchanged on true → true (PUT or PATCH), cleared on true → false', async () => {
    const s = await setup();
    await s.put({ requireStartToTrack: false });
    expect(await s.since()).toBeNull();
    await s.put({ requireStartToTrack: true });
    expect(await s.since()).toEqual(new Date(T1));
    s.at(T2);
    await s.put({ requireStartToTrack: true }); // the settings form re-sends every field on save
    await s.patch({ requireStartToTrack: true });
    await s.patch({ taskBufferMs: 600000 });
    await s.put({ timezone: 'Europe/Paris' }); // not sent: unchanged
    expect(await s.since()).toEqual(new Date(T1));
    await s.patch({ requireStartToTrack: false });
    expect(await s.since()).toBeNull();
  });

  it('on, off, on again: the second switch gives a new timestamp', async () => {
    const s = await setup();
    await s.put({ requireStartToTrack: true });
    s.at(T1 + 3_600_000);
    await s.patch({ requireStartToTrack: false });
    s.at(T2);
    await s.patch({ requireStartToTrack: true });
    expect(await s.since()).toEqual(new Date(T2));
  });

  it('a first PUT that creates the settings in manual mode sets it too', async () => {
    const s = await setup();
    await s.put({ requireStartToTrack: true });
    expect(await s.since()).toEqual(new Date(T1));
  });

  it('a client cannot set it, and no response carries it', async () => {
    const s = await setup();
    const put = await s.put({ requireStartToTrack: false, requireStartSince: '2020-01-01T00:00:00.000Z' });
    expect(await s.since()).toBeNull();
    expect(put.json()).not.toHaveProperty('requireStartSince');
    const patch = await s.patch({ requireStartToTrack: true, requireStartSince: '2020-01-01T00:00:00.000Z' });
    expect(await s.since()).toEqual(new Date(T1));
    expect(patch.json()).not.toHaveProperty('requireStartSince');
    const got = await s.ctx.app.inject({ method: 'GET', url: '/settings', headers: s.auth });
    expect(got.json()).not.toHaveProperty('requireStartSince');
    expect(got.json()).toMatchObject({ requireStartToTrack: true });
  });
});

describe('mode switches racing each other always leave a consistent (mode, timestamp) pair', () => {
  const T0 = new Date('2026-01-05T08:00:00.000Z');
  const NOW = Date.parse('2026-01-05T12:00:00.000Z');
  /** Holds the FIRST settings read (the first request's stored read) until `release` is called. */
  function gated(initial: { requireStartToTrack: boolean; requireStartSince: Date | null }) {
    const ctx = buildTestApp({
      settings: {
        id: 's1', userId: 'u1', timezone: 'UTC', workingHours: [] as never, horizonDays: 7, defaultMinChunkMs: 1800000,
        defaultMaxChunkMs: 3600000, meetingBufferMs: 0, taskBufferMs: 0, dayStartMinute: 0,
        createdAt: new Date(0), updatedAt: new Date(0), ...initial,
      },
      now: () => NOW,
    });
    const realGet = ctx.settings.getByUserId.bind(ctx.settings);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    ctx.settings.getByUserId = async (u: string) => {
      const v = await realGet(u);
      if (first) { first = false; await gate; }
      return v;
    };
    return { ctx, release, final: () => realGet('u1') };
  }
  const put = { timezone: 'UTC', workingHours: [], defaultMinChunkMs: 1800000, defaultMaxChunkMs: 3600000 };

  it('a save that keeps manual tracking on (read: on) racing a switch off ends off with no timestamp, or on with its own', async () => {
    const { ctx, release, final } = gated({ requireStartToTrack: true, requireStartSince: T0 });
    const auth = { authorization: `Bearer ${await tokenFor(ctx.app)}` };
    const saving = ctx.app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...put, requireStartToTrack: true } });
    await new Promise((r) => setTimeout(r, 20)); // the save has read "on" and waits
    const switchingOff = ctx.app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { requireStartToTrack: false } });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([saving, switchingOff]);
    const s = await final();
    // Never manual with a null timestamp (the next GET /schedule would sweep all kept history).
    expect([[false, null], [true, T0]]).toContainEqual([s?.requireStartToTrack, s?.requireStartSince]);
  });

  it('two switches on at once: one timestamp, the first one', async () => {
    const { ctx, release, final } = gated({ requireStartToTrack: false, requireStartSince: null });
    const auth = { authorization: `Bearer ${await tokenFor(ctx.app)}` };
    const a = ctx.app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { requireStartToTrack: true } });
    await new Promise((r) => setTimeout(r, 20));
    const b = ctx.app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...put, requireStartToTrack: true } });
    release();
    await Promise.all([a, b]);
    expect(await final()).toMatchObject({ requireStartToTrack: true, requireStartSince: new Date(NOW) });
  });

  it('a save that keeps automatic tracking (read: off) racing a switch on: on with a timestamp, or off without', async () => {
    const { ctx, release, final } = gated({ requireStartToTrack: false, requireStartSince: null });
    const auth = { authorization: `Bearer ${await tokenFor(ctx.app)}` };
    const saving = ctx.app.inject({ method: 'PUT', url: '/settings', headers: auth, payload: { ...put, requireStartToTrack: false } });
    await new Promise((r) => setTimeout(r, 20));
    const switchingOn = ctx.app.inject({ method: 'PATCH', url: '/settings', headers: auth, payload: { requireStartToTrack: true } });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([saving, switchingOn]);
    const s = await final();
    expect(s?.requireStartToTrack ? s.requireStartSince : null).toEqual(s?.requireStartToTrack ? new Date(NOW) : null);
    expect(s?.requireStartToTrack === true && s.requireStartSince == null).toBe(false);
  });
});
