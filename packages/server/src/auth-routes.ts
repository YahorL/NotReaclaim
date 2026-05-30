import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema } from './schemas.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/auth/google', async () => {
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri) };
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = app.jwt.sign({ sub: user.id });
    if (deps.config.webClientUrl) {
      const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(user.id)}`;
      // NOTE: Fastify v4 arg order is redirect(code, url); flip to redirect(url, code) on the v5 upgrade.
      return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
    }
    return { token, userId: user.id };
  });
}
