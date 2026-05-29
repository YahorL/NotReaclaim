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

/** OAuth/token refresh failure (e.g. revoked grant) — re-consent required. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}
