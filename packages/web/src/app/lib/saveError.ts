import { ApiError } from '../../api/client';

/** The line shown when a save never got a server answer (offline, server down). */
export const SAVE_FAILED_NO_RESPONSE = "Couldn't save. Check your connection and try again.";

/**
 * A failed save as text: the server's own message for an ApiError, else the generic line —
 * a network failure rejects with a TypeError, which has no message worth showing.
 */
export function saveErrorText(error: unknown): string {
  return error instanceof ApiError ? error.message : SAVE_FAILED_NO_RESPONSE;
}
