# NotReclaim Google Auth + Inbound Sync — Design Spec (Milestone 3b-i)

**Date:** 2026-05-28
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Depends on:** Milestones 1 (`@notreclaim/scheduler`), 2 (`@notreclaim/db`), 3a (`@notreclaim/core`) — all merged.

## Summary

Milestone 3b-i is the Google **auth + read path**: OAuth token handling with an
encrypted refresh token at rest, a mockable typed Google Calendar client, and
inbound sync of the user's primary calendar into `CalendarEvent` rows (initial
full + incremental `syncToken`, with 410 recovery). It introduces a new package
`@notreclaim/google` and a small `@notreclaim/db` schema addition for sync state.

There are no real Google credentials, so everything is built and tested against a
mockable `GoogleClient` interface. There is no HTTP server: the OAuth callback
route, watch-channel webhook, and poll timer are milestone 4. A one-time CLI
consent script (throwaway loopback) seeds the refresh token.

## Goals

- OAuth token service: consent URL, code→token exchange, access-token refresh.
- AES-256-GCM encryption of the refresh token at rest (`User.googleRefreshToken`).
- A typed, mockable `GoogleClient` interface + a real `google-auth-library`/`fetch`
  adapter + a `FakeGoogleClient` for tests.
- New `CalendarSyncState` table + repository for per-calendar `syncToken`.
- Inbound sync of the primary calendar: initial full + incremental, 410 recovery,
  event mapping into `CalendarEvent` rows.
- A one-time CLI consent script.

## Non-Goals (3b-i)

- Outbound write-back, the reconcile/diff orchestrator, the conflict/pin rule
  (milestone 3b-ii).
- The OAuth callback HTTP route, the watch-channel webhook receiver, and the poll
  timer (milestone 4).
- Syncing calendars other than the primary (chosen scope: primary only).

## Package

New package **`@notreclaim/google`** (`packages/google`), depending on
`@notreclaim/db` and `google-auth-library`. Sync logic takes injected repository
interfaces (DB-free tests). Also reopens `@notreclaim/db` for the
`CalendarSyncState` table + repository.

```
packages/google/
  package.json                 # @notreclaim/google
  tsconfig.json
  vitest.config.ts
  src/
    errors.ts                  # GoogleNotConnectedError, SyncTokenExpiredError, GoogleApiError, GoogleAuthError
    config.ts                  # typed env access + ENCRYPTION_KEY validation
    encryption.ts              # encryptToken / decryptToken (AES-256-GCM)
    client.ts                  # GoogleClient interface + GoogleEvent types
    google-client.ts           # real adapter (google-auth-library + fetch)
    token-service.ts           # connectFromCode, getAccessToken
    sync.ts                    # syncPrimaryCalendar + event mapping
    index.ts
  scripts/
    connect.ts                 # one-time CLI consent (manual)
  test/
    fakes.ts                   # FakeGoogleClient + fake repos
    encryption.test.ts
    token-service.test.ts
    sync.test.ts
```

## Sync-state storage (`@notreclaim/db` addition)

New table **`CalendarSyncState`**:
- `id`, `userId`, `googleCalendarId`, `syncToken` (nullable), `lastSyncedAt`
  (nullable `timestamptz`), `createdAt`, `updatedAt`.
- Unique `(userId, googleCalendarId)`; cascade-delete relation from `User`.
- (Watch-channel columns deferred to milestone 4.)

New **`CalendarSyncStateRepository`**:
- `getByCalendar(userId, googleCalendarId) → CalendarSyncState | null`
- `upsert(userId, googleCalendarId, { syncToken, lastSyncedAt }) → CalendarSyncState`

## Google client interface

```ts
interface GoogleTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number;   // epoch ms
  googleUserId: string;
  email: string;
}

interface GoogleEvent {
  id: string;
  status: string;                 // 'confirmed' | 'tentative' | 'cancelled'
  summary: string | null;
  start: { dateTime?: string; date?: string } | null;
  end: { dateTime?: string; date?: string } | null;
}

interface ListEventsResult {
  events: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

interface GoogleClient {
  getConsentUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  listEvents(args: {
    accessToken: string;
    calendarId: string;
    syncToken?: string;
    pageToken?: string;
    timeMin?: string;             // RFC3339, used only on initial full sync
  }): Promise<ListEventsResult>;
}
```

- The real adapter `createGoogleClient(config)` implements this with
  `google-auth-library` (OAuth) + `fetch` (Calendar REST).
- On HTTP 410 from `listEvents` (expired `syncToken`), the adapter throws
  `SyncTokenExpiredError`. Other non-2xx responses throw `GoogleApiError`.
- `FakeGoogleClient` (tests) returns canned pages including cancelled events and a
  410 path.

**OAuth scopes** (seeded once; used by 3b-i read and 3b-ii write):
`openid`, `email`, `https://www.googleapis.com/auth/calendar`.

## Token encryption

- `encryptToken(plaintext, key) → string`, `decryptToken(ciphertext, key) → plaintext`.
- AES-256-GCM, random 12-byte IV, output packs `iv | authTag | ciphertext` as
  base64. `key` is a 32-byte value from `ENCRYPTION_KEY`.
- Wrong key or tampered ciphertext throws.

## Token service

Wraps `GoogleClient` + `UserRepository` + encryption.
- `connectFromCode(code, redirectUri) → User`: exchange code → tokens; encrypt the
  refresh token; create-or-update the user (`googleId`, `email`, encrypted
  `googleRefreshToken`).
- `getAccessToken(userId, now) → string`: load user; if no refresh token, throw
  `GoogleNotConnectedError`; decrypt it; return a cached access token if
  `cachedExpiresAt > now`, otherwise refresh via the client and cache it (cache
  keyed by `userId`; `now` injected for determinism).

## Inbound sync engine

`syncPrimaryCalendar(deps, userId, now) → { upserted, deleted, fullResync }`,
`deps = { client, tokens, syncState, events }` (injected interfaces;
`calendarId = 'primary'`).

1. Load `CalendarSyncState` for `(userId, 'primary')`; obtain an access token.
2. **Incremental** (a `syncToken` exists): `listEvents({ syncToken })`, paging via
   `nextPageToken`. If `SyncTokenExpiredError` is thrown, clear the token and fall
   through to full sync (`fullResync = true`).
3. **Full** (no `syncToken`): `listEvents({ timeMin: startOfToday })`, paging. No
   `timeMax` (incompatible with obtaining a `syncToken`; the scheduler bounds its
   own reads by horizon).
4. Per page, map events → `CalendarEvent` rows:
   - **Timed** events (`start.dateTime`) → `upsertMany`.
   - **Cancelled** events (`status === 'cancelled'`) → collect ids →
     `deleteByGoogleEventIds`.
   - **All-day** events (`start.date`, no time) are **skipped** in v1 (they
     typically should not block focus time).
5. Persist `nextSyncToken` + `lastSyncedAt` to `CalendarSyncState`.

`startOfToday` is derived from the injected `now` in UTC for v1 (timezone-aware
windowing already happens in the scheduler via `@notreclaim/core`).

## One-time consent script

`scripts/connect.ts` — a manual CLI tool (not the app server): starts a throwaway
one-shot loopback HTTP server on a fixed localhost port, prints the consent URL,
catches the redirect `code`, calls `connectFromCode`, prints success, exits. Uses
real `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`ENCRYPTION_KEY` from env. Manual
and not unit-tested; every function it calls is tested via the fake client.

## Configuration

Typed env access (`config.ts`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REDIRECT_URI`, `ENCRYPTION_KEY` (validated to decode to 32 bytes). Missing
or invalid values throw a clear error. `.env*` stays gitignored.

## Error handling

- `SyncTokenExpiredError` (HTTP 410) → automatic full resync (caught internally).
- `GoogleNotConnectedError` → user has no stored refresh token.
- `GoogleApiError` wraps non-2xx Calendar responses (status + message); the caller
  (M4 scheduler) decides retry/backoff.
- `GoogleAuthError` → refresh failure (e.g. revoked grant), so M4 can prompt
  re-consent.

## Testing

- **Encryption:** round-trip (`decrypt(encrypt(x)) === x`); wrong key throws;
  tampered ciphertext throws.
- **Token service:** `connectFromCode` stores an *encrypted* token (assert not
  plaintext; decrypts back); `getAccessToken` refreshes, caches, and re-refreshes
  after expiry (driven by injected `now`); not-connected throws. Against
  `FakeGoogleClient` + fake `UserRepository`.
- **Sync engine:** initial full sync upserts timed events and skips all-day;
  incremental applies upserts + deletes cancelled; 410 → full resync;
  `syncToken`/`lastSyncedAt` persisted. Against `FakeGoogleClient` + fake repos
  (DB-free).
- **`CalendarSyncStateRepository`:** real test-Postgres integration (upsert
  idempotency, user scoping, cascade) — same harness as milestone 2.
- The real `createGoogleClient` adapter is exercised only via typecheck/build (no
  live network).
