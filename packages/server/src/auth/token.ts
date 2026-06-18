import type { FastifyInstance } from 'fastify';

export const TOKEN_TTL = '30d';

/** Sign a 30-day session token for a user id. */
export function signSession(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: TOKEN_TTL });
}
