import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import type {
  SettingsRepository,
  TaskRepository,
  HabitRepository,
  ScheduledBlockRepository,
} from '@notreclaim/db';
import type { SchedulingRepositories } from '@notreclaim/core';
import type { GoogleClient, TokenService, ReconcileResult } from '@notreclaim/google';
import { mapDomainError } from './errors.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerTaskRoutes } from './task-routes.js';
import { registerHabitRoutes } from './habit-routes.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { registerScheduleRoutes } from './schedule-routes.js';

export interface AppDeps {
  repos: {
    settings: SettingsRepository;
    tasks: TaskRepository;
    habits: HabitRepository;
    scheduledBlocks: Pick<ScheduledBlockRepository, 'listByUserInRange'>;
  };
  google: {
    client: Pick<GoogleClient, 'getConsentUrl'>;
    tokens: Pick<TokenService, 'connectFromCode'>;
  };
  schedulingRepos: SchedulingRepositories;
  reconcile: (userId: string, now: number) => Promise<ReconcileResult>;
  config: { jwtSecret: string; googleRedirectUri: string };
  now: () => number;
}

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

  registerAuthRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerHabitRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerScheduleRoutes(app, deps);

  return app;
}
