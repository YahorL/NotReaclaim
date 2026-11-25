import { ApiError, NO_SERVER_CODE } from '../../api/client';

/** The line shown when a save never got a server answer (offline, server down). */
export const SAVE_FAILED_NO_RESPONSE = "Couldn't save. Check your connection and try again.";

/** What a gateway (Caddy in production) answers while the API behind it is stopped or restarting. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/**
 * True when a failed request got no answer from the API itself: the fetch rejected (a network
 * failure rejects with a TypeError), or a proxy in front of the API answered 502/503/504 with its
 * own page. The API's own 502 (a Google failure) carries its JSON error code, so it is an answer
 * and keeps its message; a 500 and every 4xx are answers too.
 */
export function isServerUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return GATEWAY_STATUSES.has(error.status) && error.code === NO_SERVER_CODE;
}

/** A failed save as text: the server's own message, or the generic line when the server never answered. */
export function saveErrorText(error: unknown): string {
  return error instanceof ApiError && !isServerUnreachable(error) ? error.message : SAVE_FAILED_NO_RESPONSE;
}
