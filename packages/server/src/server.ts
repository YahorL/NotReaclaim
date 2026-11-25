import {
  prisma,
  createUserRepository,
  createSettingsRepository,
  createTaskRepository,
  createHabitRepository,
  createScheduledBlockRepository,
  createCalendarEventRepository,
  createCalendarSyncStateRepository,
  createCategoryRepository,
  createSubtaskRepository,
  createInviteCodeRepository,
} from '@notreclaim/db';
import {
  createGoogleClient,
  createTokenService,
  reconcile,
  syncPrimaryCalendar,
  loadGoogleConfig,
} from '@notreclaim/google';
import { planLocally, type Exclusive } from '@notreclaim/core';
import { buildApp } from './app.js';
import { createEventBus } from './events.js';
import { makeReplan, type ReplanPath } from './replan-router.js';
import { pollAndReplan } from './replan.js';
import { startPoller } from './poller.js';
import { loadServerConfig } from './config.js';
import { createUserLock } from './user-lock.js';
import { isGoogleConnected } from './auth/google-connection.js';

async function main(): Promise<void> {
  const serverConfig = loadServerConfig();
  const googleConfig = loadGoogleConfig();

  const client = createGoogleClient({ clientId: googleConfig.clientId, clientSecret: googleConfig.clientSecret });
  const users = createUserRepository(prisma);
  // The bus is created up front so a token refresh can announce a broken/restored connection.
  const bus = createEventBus();
  const tokens = createTokenService({
    client,
    users,
    encryptionKey: googleConfig.encryptionKey,
    onAuthStatusChange: (userId, broken) => bus.emit({ type: 'google.status', userId, broken }),
  });

  const settings = createSettingsRepository(prisma);
  const tasks = createTaskRepository(prisma);
  const habits = createHabitRepository(prisma);
  const scheduledBlocks = createScheduledBlockRepository(prisma);
  const calendarEvents = createCalendarEventRepository(prisma);
  const calendarSyncState = createCalendarSyncStateRepository(prisma);
  const categories = createCategoryRepository(prisma);
  const subtasks = createSubtaskRepository(prisma);
  const invites = createInviteCodeRepository(prisma);

  const schedulingRepos = { settings, calendarEvents, tasks, habits, scheduledBlocks, categories };

  // ONE lock per process, shared by both replan paths (around compute + apply) and the block
  // routes (around each read-modify-write): an edit waits for an in-flight apply instead of
  // being overwritten by it. Like the replan queue, it assumes a single server process.
  const userLock = createUserLock();
  const exclusiveFor = (userId: string): Exclusive => (fn) => userLock(userId, fn);

  const reconcileBound: ReplanPath = (userId, now, onRowFailure) =>
    reconcile({ client, tokens, users, scheduledBlocks, schedulingRepos, exclusive: exclusiveFor(userId), onRowFailure }, userId, now);
  const syncBound = (userId: string, now: number) =>
    syncPrimaryCalendar({ client, tokens, syncState: calendarSyncState, events: calendarEvents }, userId, now);

  const planLocallyBound: ReplanPath = (userId, now, onRowFailure) =>
    planLocally(schedulingRepos, scheduledBlocks, userId, now, exclusiveFor(userId), onRowFailure);
  const isConnected = async (userId: string): Promise<boolean> => isGoogleConnected(await users.findById(userId));
  // The ONE replan every entry point uses (routes via buildApp AND the poll below): it is
  // serialised per user, so a second instance or a direct reconcileBound call would bypass it.
  const replan = makeReplan({
    reconcile: reconcileBound,
    planLocally: planLocallyBound,
    isConnected,
    // Called only once a replan has run, i.e. after `app` below exists.
    warn: (fields, message) => app.log.warn(fields, message),
  });

  const app = buildApp({
    logger: true,
    repos: { settings, tasks, habits, scheduledBlocks, calendarEvents, categories, subtasks, users, invites },
    google: { client, tokens },
    replan,
    withUserLock: userLock,
    events: bus,
    config: {
      jwtSecret: serverConfig.jwtSecret,
      googleRedirectUri: googleConfig.redirectUri,
      webClientUrl: serverConfig.webClientUrl,
      registrationMode: serverConfig.registrationMode,
    },
  });

  await app.listen({ port: serverConfig.port, host: '0.0.0.0' });
  app.log.info(`NotReclaim server listening on :${serverConfig.port}`);

  const poller = startPoller({
    listConnectedIds: () => users.listConnectedIds(),
    pollAndReplan: (userId) =>
      pollAndReplan(
        { sync: syncBound, replan, bus, now: () => Date.now() },
        userId,
      ),
    intervalMs: serverConfig.pollIntervalMs,
    log: (err) => app.log.error(err),
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    poller.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
