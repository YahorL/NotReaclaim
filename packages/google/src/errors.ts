/** The user has not connected Google (no stored refresh token). */
export class GoogleNotConnectedError extends Error {
  constructor(userId: string) {
    super(`User ${userId} has not connected Google`);
    this.name = 'GoogleNotConnectedError';
  }
}

/** Google returned HTTP 410: the sync token expired and a full resync is needed. */
export class SyncTokenExpiredError extends Error {
  constructor(message = 'Sync token expired (HTTP 410)') {
    super(message);
    this.name = 'SyncTokenExpiredError';
  }
}

/** A non-2xx response from the Google Calendar API. */
export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(`Google API error ${status}: ${message}`);
    this.name = 'GoogleApiError';
  }
}

/**
 * A Calendar API request got no complete answer within the client's timeout. It is a failed
 * Google call like any other GoogleApiError (the server answers 502; a poll cycle logs it and
 * the next cycle retries) — never a revoked grant or an expired sync token. `status` is the
 * conventional 504 (gateway timeout); Google itself sent nothing.
 */
export class GoogleTimeoutError extends GoogleApiError {
  constructor(public readonly timeoutMs: number) {
    super(504, `no response within ${timeoutMs} ms`);
    this.name = 'GoogleTimeoutError';
  }
}

/** OAuth/token failure. May be transient (outage, timeout) — see GoogleGrantRevokedError. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

/**
 * Google refused the stored refresh token itself (`invalid_grant`): the user revoked access,
 * changed their password, or the grant expired. Unlike a plain GoogleAuthError this is
 * permanent, so it — and only it — may flag the connection as broken and ask for a re-consent.
 */
export class GoogleGrantRevokedError extends GoogleAuthError {
  constructor(message = 'Google refresh token was revoked or has expired') {
    super(message);
    this.name = 'GoogleGrantRevokedError';
  }
}
