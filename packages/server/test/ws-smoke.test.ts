import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { buildTestApp, tokenFor } from './fakes.js';

type App = Awaited<ReturnType<typeof buildTestApp>>['app'];

const apps: App[] = [];

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function listen() {
  const built = buildTestApp();
  apps.push(built.app);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = built.app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { ...built, port };
}

describe('/ws (localhost smoke)', () => {
  it('a valid token connects and receives a forwarded event', async () => {
    const { app, events, port } = await listen();
    const token = await tokenFor(app, 'u1');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${token}`);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    const received = new Promise<string>((resolve, reject) => {
      ws.on('message', (d) => resolve(d.toString()));
      ws.on('error', reject);
    });
    events.emit({ type: 'schedule.updated', userId: 'u1', counts: { created: 1, updated: 0, deleted: 0, pinned: 0, removed: 0 } });
    const msg = JSON.parse(await received);

    expect(msg).toMatchObject({ type: 'schedule.updated', userId: 'u1' });
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
    });
  });

  it('a bad token is rejected (socket closes)', async () => {
    const { port } = await listen();
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=garbage`);
    const code = await new Promise<number>((resolve) => {
      ws.on('close', (c) => resolve(c));
      ws.on('error', () => {});
    });
    expect(code).toBe(1008);
  });
});
