import type { FastifyInstance } from 'fastify';
import type { CalendarEvent } from '@notreclaim/db';
import { PRIMARY_CALENDAR_ID } from '@notreclaim/google';
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
 * Best-effort mirror of a just-created app event to the user's primary Google calendar.
 * Returns the row carrying the Google ids, or `event` unchanged when anything failed (no
 * Google account, the insert, or storing the ids — the last one orphans the Google copy).
 */
export async function mirrorNewAppEvent(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'google' | 'now'> & { repos: Pick<AppDeps['repos'], 'calendarEvents'> },
  userId: string,
  event: CalendarEvent,
  body: { title: string; startsAt: string; endsAt: string },
): Promise<CalendarEvent> {
  let mirrored = event;
  await bestEffortGoogleWrite(
    app, deps, userId,
    { fields: { eventId: event.id }, message: 'google write-back failed: event not mirrored' },
    async (accessToken) => {
      const { googleEventId } = await deps.google.client.insertEvent(accessToken, PRIMARY_CALENDAR_ID, {
        summary: body.title, startDateTime: body.startsAt, endDateTime: body.endsAt,
      });
      mirrored = await deps.repos.calendarEvents.setGoogleIds(userId, event.id, PRIMARY_CALENDAR_ID, googleEventId);
    },
  );
  return mirrored;
}

/**
 * Best-effort write-back of an edit to an event previously mirrored to Google (`before` carries
 * the ids; a row without both is skipped without a token lookup). PATCH (merge), not PUT — the
 * user may have added a description/location/attendees on the Google side. A failure leaves the
 * Google copy stale, so it must be visible in the log.
 */
export async function mirrorAppEventEdit(
  app: FastifyInstance,
  deps: Pick<AppDeps, 'google' | 'now'>,
  userId: string,
  before: CalendarEvent,
  merged: { title: string; startsAt: Date; endsAt: Date },
): Promise<void> {
  const { googleEventId, googleCalendarId } = before;
  if (!googleEventId || !googleCalendarId) return;
  await bestEffortGoogleWrite(
    app, deps, userId,
    { fields: { eventId: before.id }, message: 'google write-back failed: event edit not mirrored' },
    (accessToken) => deps.google.client.patchEvent(accessToken, googleCalendarId, googleEventId, {
      summary: merged.title, startDateTime: merged.startsAt.toISOString(), endDateTime: merged.endsAt.toISOString(),
    }),
  );
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
