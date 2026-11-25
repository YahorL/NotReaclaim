import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';

/**
 * Best-effort Google write-back: look up the user's access token and run one Google call with
 * it. Any failure — no Google account, or a Google error — is logged as a warning and swallowed,
 * because the local row is authoritative and the request must not fail on Google's account.
 */
export async function bestEffortGoogleWrite(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'google' | 'now'>,
  userId: string,
  onFailure: { fields: Record<string, unknown>; message: string },
  call: (accessToken: string) => Promise<unknown>,
): Promise<void> {
  try {
    const accessToken = await deps.google.tokens.getAccessToken(userId, deps.now());
    await call(accessToken);
  } catch (err) {
    app.log.warn({ err, ...onFailure.fields }, onFailure.message);
  }
}

/**
 * Best-effort removal of a row's mirrored Google event. A row without BOTH Google ids (or no
 * row at all) returns at once — it never even looks up an access token.
 */
export async function removeMirroredEvent(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'google' | 'now'>,
  userId: string,
  row: { googleEventId: string | null; googleCalendarId: string | null } | null | undefined,
  onFailure: { fields: Record<string, unknown>; message: string },
): Promise<void> {
  const googleEventId = row?.googleEventId;
  const googleCalendarId = row?.googleCalendarId;
  if (!googleEventId || !googleCalendarId) return;
  await bestEffortGoogleWrite(
    app, deps, userId, onFailure,
    (accessToken) => deps.google.client.deleteEvent(accessToken, googleCalendarId, googleEventId),
  );
}
