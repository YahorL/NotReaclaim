import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type {
  SettingsRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
  CalendarEventRepository,
  CategoryRepository,
  SubtaskRepository,
  UserRepository,
  InviteCodeRepository,
} from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import type { RegistrationMode } from './config.js';
import type { GoogleClient, TokenService, ReconcileResult } from '@notreclaim/google';
import { mapDomainError } from './errors.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerTaskRoutes } from './task-routes.js';
import { registerHabitRoutes } from './habit-routes.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { registerScheduleRoutes } from './schedule-routes.js';
import { registerCalendarRoutes } from './calendar-routes.js';
import { registerCategoryRoutes } from './category-routes.js';
import { registerSubtaskRoutes } from './subtask-routes.js';
import type { EventBus } from './events.js';
import { createConnectionRegistry } from './connection-registry.js';
import { registerWebSocket } from './ws.js';
import { replanAfterMutation } from './replan.js';

export interface AppDeps {
  repos: {
    settings: SettingsRepository;
    tasks: TaskRepository;
    habits: HabitRepository;
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange' | 'update' | 'create' | 'delete' | 'findById'>;
    calendarEvents: Pick<CalendarEventRepository, 'listByUserInRange' | 'create' | 'setGoogleIds' | 'findById' | 'delete'>;
    categories: CategoryRepository;
    subtasks: SubtaskRepository;
    users: Pick<UserRepository, 'findById' | 'findByEmail' | 'findByGoogleId' | 'create' | 'update'>;
    invites: Pick<InviteCodeRepository, 'validate' | 'consume'>;
  };
  google: {
    client: Pick<GoogleClient, 'getConsentUrl' | 'insertEvent' | 'deleteEvent'>;
    tokens: Pick<TokenService, 'connectFromCode' | 'exchangeCodeForLink' | 'getAccessToken'>;
  };
  schedulingRepos: SchedulingRepositories;
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  events: EventBus;
  config: { jwtSecret: string; googleRedirectUri: string; webClientUrl?: string; registrationMode: RegistrationMode };
  now: () => number;
}

export type AfterMutation = (
  userId: string,
  change?: { taskId: string; action: 'created' | 'updated' | 'deleted' },
) => void;

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export function buildApp(input: Omit<AppDeps, 'now'> & { now?: () => number }): FastifyInstance {
  const deps: AppDeps = { ...input, now: input.now ?? (() => Date.now()) };
  const app = Fastify({ logger: false });

  app.register(fastifyJwt, { secret: deps.config.jwtSecret });
  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const payload = await request.jwtVerify<{ sub?: string }>();
      if (!payload.sub) {
        reply.code(401).send({ code: 'unauthorized', message: 'Invalid or missing token' });
        return;
      }
      request.userId = payload.sub;
    } catch {
      reply.code(401).send({ code: 'unauthorized', message: 'Invalid or missing token' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapDomainError(error);
    if (mapped.status === 500) app.log.error(error);
    reply.code(mapped.status).send({ code: mapped.code, message: mapped.message });
  });

  const registry = createConnectionRegistry();
  deps.events.subscribe((event) => registry.forward(event));
  registerWebSocket(app, registry);

  const afterMutation: AfterMutation = (userId, change) => {
    if (change) deps.events.emit({ type: 'task.changed', userId, ...change });
    void replanAfterMutation(
      { reconcile: deps.reconcile, bus: deps.events, now: deps.now, log: (err) => app.log.error(err) },
      userId,
    );
  };

  registerAuthRoutes(app, deps);
  registerTaskRoutes(app, deps, afterMutation);
  registerHabitRoutes(app, deps, afterMutation);
  registerSettingsRoutes(app, deps, afterMutation);
  registerScheduleRoutes(app, deps, afterMutation);
  registerCalendarRoutes(app, deps, afterMutation);
  registerCategoryRoutes(app, deps, afterMutation);
  registerSubtaskRoutes(app, deps);

  return app;
}
