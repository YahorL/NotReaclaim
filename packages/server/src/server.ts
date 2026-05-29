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
  loadGoogleConfig,
} from '@notreclaim/google';
import { buildApp } from './app.js';
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
  void createCalendarSyncStateRepository(prisma);

  const schedulingRepos = { settings, calendarEvents, tasks, habits, scheduledBlocks };

  const app = buildApp({
    repos: { settings, tasks, habits, scheduledBlocks },
    google: { client, tokens },
    schedulingRepos,
    reconcile: (userId, now) =>
      reconcile({ client, tokens, users, scheduledBlocks, schedulingRepos }, userId, now),
    config: { jwtSecret: serverConfig.jwtSecret, googleRedirectUri: googleConfig.redirectUri },
  });

  await app.listen({ port: serverConfig.port, host: '0.0.0.0' });
  app.log.info(`NotReclaim server listening on :${serverConfig.port}`);
}

void main();
