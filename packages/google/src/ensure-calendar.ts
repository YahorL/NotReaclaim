import type { UserRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';

export interface EnsureCalendarDeps {
  client: Pick<GoogleClient, 'createCalendar'>;
  users: Pick<UserRepository, 'findById' | 'update'>;
}

const AUTO_CALENDAR_SUMMARY = 'NotReclaim';

/** Return the user's Auto-scheduled calendar id, creating + persisting it if absent. */
export async function ensureAutoScheduledCalendar(
  deps: EnsureCalendarDeps,
  userId: string,
  accessToken: string,
): Promise<string> {
  const user = await deps.users.findById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  if (user.autoScheduledCalendarId) return user.autoScheduledCalendarId;

  const { calendarId } = await deps.client.createCalendar(accessToken, AUTO_CALENDAR_SUMMARY);
  await deps.users.update(userId, { autoScheduledCalendarId: calendarId });
  return calendarId;
}
