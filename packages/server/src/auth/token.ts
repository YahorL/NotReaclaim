import type { FastifyInstance } from 'fastify';

const TOKEN_TTL = '30d';

/** Sign a 30-day session token for a user id. */
export function signSession(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: TOKEN_TTL });
}

/**
 * Verify a session token and return its user id, or null when it is invalid. A good signature
 * is not enough: OAuth state tokens are signed with the same secret but carry `st`, not `sub`,
 * so the `sub` check is what stops a state token from being accepted as a session.
 */
export function verifySession(app: FastifyInstance, token: string): string | null {
  try {
    return app.jwt.verify<{ sub?: string }>(token).sub || null;
  } catch {
    return null;
  }
}
