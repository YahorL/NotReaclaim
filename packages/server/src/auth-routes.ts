import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema } from './schemas.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/auth/google', async () => {
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri) };
  });

  app.get('/auth/google/callback', async (request) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = app.jwt.sign({ sub: user.id });
    return { token, userId: user.id };
  });
}
