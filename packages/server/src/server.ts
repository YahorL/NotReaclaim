import {
  prisma,
  createUserRepository,
  createSettingsRepository,
  createTaskRepository,
  createHabitRepository,
  createScheduledBlockRepository,
  createCalendarEventRepository,
  createCalendarSyncStateRepository,
} from '@notreclaim/db';
import {
  createGoogleClient,
  createTokenService,
  reconcile,
  syncPrimaryCalendar,
  loadGoogleConfig,
} from '@notreclaim/google';
import { buildApp } from './app.js';
import { createEventBus } from './events.js';
import { pollAndReplan } from './replan.js';
import { startScheduler } from './scheduler.js';
import { loadServerConfig } from './config.js';

async function main(): Promise<void> {
  const serverConfig = loadServerConfig();
  const googleConfig = loadGoogleConfig();

  const client = createGoogleClient({ clientId: googleConfig.clientId, clientSecret: googleConfig.clientSecret });
  const users = createUserRepository(prisma);
  const tokens = createTokenService({ client, users, encryptionKey: googleConfig.encryptionKey });

  const settings = createSettingsRepository(prisma);
  const tasks = createTaskRepository(prisma);
  const habits = createHabitRepository(prisma);
  const scheduledBlocks = createScheduledBlockRepository(prisma);
  const calendarEvents = createCalendarEventRepository(prisma);
  const calendarSyncState = createCalendarSyncStateRepository(prisma);

  const schedulingRepos = { settings, calendarEvents, tasks, habits, scheduledBlocks };
  const bus = createEventBus();

  const reconcileBound = (userId: string, now: number) =>
    reconcile({ client, tokens, users, scheduledBlocks, schedulingRepos }, userId, now);
  const syncBound = (userId: string, now: number) =>
    syncPrimaryCalendar({ client, tokens, syncState: calendarSyncState, events: calendarEvents }, userId, now);

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: { client, tokens },
    schedulingRepos,
    reconcile: reconcileBound,
    events: bus,
    config: { jwtSecret: serverConfig.jwtSecret, googleRedirectUri: googleConfig.redirectUri },
  });

  await app.listen({ port: serverConfig.port, host: '0.0.0.0' });
  app.log.info(`NotReclaim server listening on :${serverConfig.port}`);

  const scheduler = startScheduler({
    listConnectedIds: () => users.listConnectedIds(),
    pollAndReplan: (userId) =>
      pollAndReplan(
        { sync: syncBound, reconcile: reconcileBound, bus, now: () => Date.now(), log: (err) => app.log.error(err) },
        userId,
      ),
    intervalMs: serverConfig.pollIntervalMs,
    log: (err) => app.log.error(err),
  });

  const shutdown = async (): Promise<void> => {
    scheduler.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
