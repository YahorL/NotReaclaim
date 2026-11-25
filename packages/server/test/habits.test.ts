import { describe, it, expect } from 'vitest';
import { buildTestApp, tokenFor } from './fakes.js';

const habitBody = { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] };

describe('habit routes', () => {
  it('creates and lists habits', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const created = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: habitBody });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/habits', headers: auth });
    expect(list.json()).toHaveLength(1);
  });

  it('404 for a missing habit and 401 without a token', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    expect((await app.inject({ method: 'GET', url: '/habits/nope', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/habits' })).statusCode).toBe(401);
  });

  it('scopes habits by user', async () => {
    const { app } = buildTestApp();
    const tokenA = await tokenFor(app, 'userA');
    const tokenB = await tokenFor(app, 'userB');
    const created = await app.inject({
      method: 'POST', url: '/habits', headers: { authorization: `Bearer ${tokenA}` },
      payload: { title: 'Exercise', priority: 2, chunkMs: 1800000, perPeriod: 3, eligibleDays: [1, 3, 5] },
    });
    const id = created.json().id;
    const res = await app.inject({ method: 'GET', url: `/habits/${id}`, headers: { authorization: `Bearer ${tokenB}` } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting a missing habit', async () => {
    const { app } = buildTestApp();
    const token = await tokenFor(app);
    const res = await app.inject({ method: 'DELETE', url: '/habits/nope', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
  });

  it('triggers a re-plan but emits no task.changed on create', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const created = await app.inject({
      method: 'POST', url: '/habits', headers: { authorization: `Bearer ${token}` }, payload: habitBody,
    });
    expect(created.statusCode).toBe(201);

    expect(reconcileCalls).toContainEqual({ userId: 'u1', now: expect.any(Number) });
    expect(emitted.some((e) => e.type === 'task.changed')).toBe(false);
  });

  it('triggers a re-plan on habit update and delete, never emitting task.changed', async () => {
    const { app, emitted, reconcileCalls } = buildTestApp();
    const token = await tokenFor(app);
    const auth = { authorization: `Bearer ${token}` };
    const id = (await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: habitBody })).json().id;

    await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { priority: 5 } });
    await app.inject({ method: 'DELETE', url: `/habits/${id}`, headers: auth });

    expect(reconcileCalls).toHaveLength(3); // create + patch + delete
    expect(emitted.some((e) => e.type === 'task.changed')).toBe(false);
  });

  describe('preferred time-of-day window', () => {
    const setup = async () => {
      const ctx = buildTestApp();
      return { ...ctx, auth: { authorization: `Bearer ${await tokenFor(ctx.app)}` } };
    };

    it('accepts 00:00..24:00 bounds and a cleared (null) window', async () => {
      const { app, auth } = await setup();
      for (const [preferredStartMinute, preferredEndMinute] of [[0, 1440], [540, 600], [null, null]]) {
        const res = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: { ...habitBody, preferredStartMinute, preferredEndMinute } });
        expect(res.statusCode, `${preferredStartMinute}-${preferredEndMinute}`).toBe(201);
      }
    });

    it('rejects a minute outside 00:00..24:00 on create, and stores nothing', async () => {
      const { app, auth, reconcileCalls } = await setup();
      for (const [preferredStartMinute, preferredEndMinute] of [[-1, 600], [540, 1441], [540.5, 600]]) {
        const res = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: { ...habitBody, preferredStartMinute, preferredEndMinute } });
        expect(res.statusCode, `${preferredStartMinute}-${preferredEndMinute}`).toBe(400);
        expect(res.json().code).toBe('validation_error');
      }
      expect(reconcileCalls).toEqual([]);
      expect((await app.inject({ method: 'GET', url: '/habits', headers: auth })).json()).toEqual([]);
    });

    // Core drops a window whose end is not after its start (no overnight support), and the
    // habit form already refuses one — so the server refuses it too instead of storing a no-op.
    it('rejects end at or before start on create with a readable message', async () => {
      const { app, auth } = await setup();
      for (const [preferredStartMinute, preferredEndMinute] of [[600, 540], [600, 600], [1320, 120]]) {
        const res = await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: { ...habitBody, preferredStartMinute, preferredEndMinute } });
        expect(res.statusCode, `${preferredStartMinute}-${preferredEndMinute}`).toBe(400);
        expect(res.json().message).toBe('preferredEndMinute: must be after preferredStartMinute');
      }
    });

    it('PATCH checks one bound against the stored other bound, and leaves the row unchanged on rejection', async () => {
      const { app, auth } = await setup();
      const id = (await app.inject({ method: 'POST', url: '/habits', headers: auth, payload: { ...habitBody, preferredStartMinute: 540, preferredEndMinute: 600 } })).json().id;
      const endOnly = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredEndMinute: 500 } });
      expect(endOnly.statusCode).toBe(400);
      const startOnly = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredStartMinute: 600 } });
      expect(startOnly.statusCode).toBe(400);
      const both = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredStartMinute: 700, preferredEndMinute: 650 } });
      expect(both.statusCode).toBe(400);
      const outOfRange = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredEndMinute: 1500 } });
      expect(outOfRange.statusCode).toBe(400);
      const got = (await app.inject({ method: 'GET', url: `/habits/${id}`, headers: auth })).json();
      expect(got).toMatchObject({ preferredStartMinute: 540, preferredEndMinute: 600 });

      const moved = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredEndMinute: 720 } });
      expect(moved.statusCode).toBe(200);
      const cleared = await app.inject({ method: 'PATCH', url: `/habits/${id}`, headers: auth, payload: { preferredStartMinute: null, preferredEndMinute: null } });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({ preferredStartMinute: null, preferredEndMinute: null });
    });

    it('PATCH that touches neither bound still works on a stored inverted row', async () => {
      const ctx = buildTestApp({
        habits: [{
          id: 'h-bad', userId: 'u1', title: 'Old', priority: 1, chunkMs: 1800000, perPeriod: 1, eligibleDays: [1],
          periodType: 'week', preferredStartMinute: 1320, preferredEndMinute: 120, status: 'active',
          createdAt: new Date(0), updatedAt: new Date(0),
        } as never],
      });
      const auth = { authorization: `Bearer ${await tokenFor(ctx.app)}` };
      const res = await ctx.app.inject({ method: 'PATCH', url: '/habits/h-bad', headers: auth, payload: { title: 'Renamed' } });
      expect(res.statusCode).toBe(200);
    });

    it('PATCH of a bound on a missing habit is a 404', async () => {
      const { app, auth } = await setup();
      const res = await app.inject({ method: 'PATCH', url: '/habits/nope', headers: auth, payload: { preferredEndMinute: 600 } });
      expect(res.statusCode).toBe(404);
    });
  });
});
