import type { FastifyInstance } from 'fastify';

const TOKEN_TTL = '30d';

/** Sign a 30-day session token for a user id. */
export function signSession(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: TOKEN_TTL });
}

/**
 * The user id of a verified JWT payload, or null when it is not a session. A good signature is
 * not enough: OAuth state tokens are signed with the same secret but carry `st`, not `sub`, so
 * the `sub` check is what stops a state token from being accepted as a session.
 */
export function sessionUserId(payload: { sub?: string }): string | null {
  return payload.sub || null;
}

/** Verify a raw session token (e.g. from the WS handshake); null when invalid, never throws. */
export function verifySession(app: FastifyInstance, token: string): string | null {
  try {
    return sessionUserId(app.jwt.verify<{ sub?: string }>(token));
  } catch {
    return null;
  }
}
