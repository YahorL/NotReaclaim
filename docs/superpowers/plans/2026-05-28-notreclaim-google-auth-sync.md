# NotReclaim Google Auth + Inbound Sync Implementation Plan (Milestone 3b-i)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@notreclaim/google` — OAuth token handling with an encrypted refresh token, a mockable Google Calendar client, and inbound primary-calendar sync — plus a `CalendarSyncState` table in `@notreclaim/db`.

**Architecture:** A new package `@notreclaim/google` whose logic (token service, sync engine) depends only on a typed `GoogleClient` interface and injected repository interfaces, so it is fully tested against a `FakeGoogleClient` and fake repos with no network and no DB. A thin real adapter wraps `google-auth-library` + `fetch`. The new `CalendarSyncState` table/repo (in `@notreclaim/db`) persists per-calendar `syncToken` and is integration-tested against the real test Postgres.

**Tech Stack:** TypeScript (ESM, strict, `.js` import extensions), `google-auth-library`, Node `crypto` (AES-256-GCM), Prisma/Postgres, Vitest, npm workspaces.

---

## Prerequisites

- Tasks 1 (db) needs the running userspace Postgres (already up; `packages/db/.env`/`.env.test` set).
- Tasks 2–9 (the `@notreclaim/google` package) need **no** database and **no** Google credentials — all tests use fakes.
- No real Google OAuth credentials are required to complete this plan. The consent script (Task 8) is a manual tool exercised later by the user.

## Conventions & invariants

- Weekday/timezone concerns live in `@notreclaim/core`; this milestone deals in epoch ms / `Date` only. `startOfToday` for the initial sync is computed in **UTC** from the injected `now`.
- No `Date.now`/`Math.random` in the deterministic logic except where genuinely needed (the AES IV uses `crypto.randomBytes`, which is correct for encryption).
- `calendarId` is the literal `'primary'`.

## File Structure

```
packages/db/prisma/schema.prisma                         # MODIFY: CalendarSyncState model + User relation
packages/db/src/repositories/calendar-sync-state-repository.ts  # NEW
packages/db/src/index.ts                                 # MODIFY: export repo + CalendarSyncState type
packages/db/test/repositories/calendar-sync-state-repository.test.ts  # NEW
packages/google/
  package.json
  tsconfig.json
  tsconfig.scripts.json
  vitest.config.ts
  src/
    errors.ts
    config.ts
    encryption.ts
    client.ts                 # GoogleClient interface + GoogleEvent types
    google-client.ts          # real adapter (google-auth-library + fetch)
    token-service.ts
    sync.ts
    index.ts
  scripts/
    connect.ts                # one-time consent (manual)
  test/
    fakes.ts
    config.test.ts
    encryption.test.ts
    token-service.test.ts
    sync.test.ts
```

---

### Task 1: `CalendarSyncState` table + repository (`@notreclaim/db`)

**Requires Postgres.**

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/repositories/calendar-sync-state-repository.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/test/repositories/calendar-sync-state-repository.test.ts`

- [ ] **Step 1: Add the model to `packages/db/prisma/schema.prisma`.** Add a `calendarSyncStates CalendarSyncState[]` relation field to the `User` model (alongside its other relations), then append this model:

```prisma
model CalendarSyncState {
  id               String    @id @default(uuid())
  userId           String
  googleCalendarId String
  syncToken        String?
  lastSyncedAt     DateTime? @db.Timestamptz
  createdAt        DateTime  @default(now()) @db.Timestamptz
  updatedAt        DateTime  @updatedAt @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, googleCalendarId])
}
```

- [ ] **Step 2: Create and apply the migration.**
Run: `cd packages/db && npx prisma migrate dev --name calendar_sync_state`
Expected: a new migration is created and applied to `notreclaim_dev`; "Your database is now in sync."

- [ ] **Step 3: Write the failing test `packages/db/test/repositories/calendar-sync-state-repository.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createCalendarSyncStateRepository } from '../../src/repositories/calendar-sync-state-repository.js';

const users = createUserRepository(prisma);
const repo = createCalendarSyncStateRepository(prisma);

describe('CalendarSyncStateRepository', () => {
  it('returns null before any state and creates on first upsert', async () => {
    const user = await users.create({ email: 'ss@example.com' });
    expect(await repo.getByCalendar(user.id, 'primary')).toBeNull();
    const created = await repo.upsert(user.id, 'primary', { syncToken: 'tok-1', lastSyncedAt: new Date('2026-01-01T00:00:00.000Z') });
    expect(created).toMatchObject({ userId: user.id, googleCalendarId: 'primary', syncToken: 'tok-1' });
  });

  it('updates the sync token on a second upsert (idempotent on the calendar key)', async () => {
    const user = await users.create({ email: 'ss2@example.com' });
    await repo.upsert(user.id, 'primary', { syncToken: 'tok-1', lastSyncedAt: new Date('2026-01-01T00:00:00.000Z') });
    const updated = await repo.upsert(user.id, 'primary', { syncToken: 'tok-2', lastSyncedAt: new Date('2026-01-02T00:00:00.000Z') });
    expect(updated.syncToken).toBe('tok-2');
    const fetched = await repo.getByCalendar(user.id, 'primary');
    expect(fetched?.syncToken).toBe('tok-2');
  });

  it('scopes by user', async () => {
    const a = await users.create({ email: 'ssa@example.com' });
    const b = await users.create({ email: 'ssb@example.com' });
    await repo.upsert(a.id, 'primary', { syncToken: 'a-tok', lastSyncedAt: null });
    expect(await repo.getByCalendar(b.id, 'primary')).toBeNull();
  });

  it('cascade-deletes when the user is removed', async () => {
    const user = await users.create({ email: 'ssc@example.com' });
    await repo.upsert(user.id, 'primary', { syncToken: 'tok', lastSyncedAt: null });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.calendarSyncState.count({ where: { userId: user.id } })).toBe(0);
  });
});
```

- [ ] **Step 4: Run to verify failure.**
Run: `cd packages/db && npx vitest run test/repositories/calendar-sync-state-repository.test.ts`
Expected: FAIL — cannot find module `calendar-sync-state-repository.js`.

- [ ] **Step 5: Implement `packages/db/src/repositories/calendar-sync-state-repository.ts`**

```ts
import type { PrismaClient, CalendarSyncState } from '@prisma/client';

export interface UpsertSyncStateInput {
  syncToken?: string | null;
  lastSyncedAt?: Date | null;
}

export function createCalendarSyncStateRepository(prisma: PrismaClient) {
  return {
    getByCalendar(userId: string, googleCalendarId: string): Promise<CalendarSyncState | null> {
      return prisma.calendarSyncState.findUnique({
        where: { userId_googleCalendarId: { userId, googleCalendarId } },
      });
    },

    upsert(
      userId: string,
      googleCalendarId: string,
      data: UpsertSyncStateInput,
    ): Promise<CalendarSyncState> {
      return prisma.calendarSyncState.upsert({
        where: { userId_googleCalendarId: { userId, googleCalendarId } },
        create: { userId, googleCalendarId, ...data },
        update: data,
      });
    },
  };
}

export type CalendarSyncStateRepository = ReturnType<typeof createCalendarSyncStateRepository>;
```

- [ ] **Step 6: Export from `packages/db/src/index.ts`.** Add to the repository exports:

```ts
export { createCalendarSyncStateRepository } from './repositories/calendar-sync-state-repository.js';
export type { CalendarSyncStateRepository, UpsertSyncStateInput } from './repositories/calendar-sync-state-repository.js';
```

And add `CalendarSyncState` to the existing Prisma model-type re-export block:

```ts
export type { CalendarSyncState } from '@prisma/client';
```

- [ ] **Step 7: Run the test + rebuild db.**
Run: `cd packages/db && npx vitest run test/repositories/calendar-sync-state-repository.test.ts && npm run build`
Expected: 4 tests pass; build clean (so `@notreclaim/google` can resolve the new types).

- [ ] **Step 8: Commit.**

```bash
git add packages/db/prisma packages/db/src/repositories/calendar-sync-state-repository.ts packages/db/src/index.ts packages/db/test/repositories/calendar-sync-state-repository.test.ts
git commit -m "feat(db): add CalendarSyncState table and repository"
```

---

### Task 2: Scaffold `@notreclaim/google`

**Files:**
- Create: `packages/google/package.json`, `tsconfig.json`, `tsconfig.scripts.json`, `vitest.config.ts`
- Create: `packages/google/src/errors.ts`

- [ ] **Step 1: Create `packages/google/package.json`**

```json
{
  "name": "@notreclaim/google",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc -p tsconfig.json",
    "typecheck:scripts": "tsc -p tsconfig.scripts.json --noEmit",
    "connect": "node --experimental-strip-types scripts/connect.ts"
  },
  "dependencies": {
    "@notreclaim/db": "*",
    "google-auth-library": "^9.14.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/google/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/google/tsconfig.scripts.json`** (typecheck the manual script without emitting it into `dist`)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "scripts"]
}
```

- [ ] **Step 4: Create `packages/google/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create `packages/google/src/errors.ts`**

```ts
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
```

- [ ] **Step 6: Install + build prerequisites.**
Run: `npm install`
Then: `npm run build -w @notreclaim/db`
Then type-check the package compiles so far: `cd packages/google && npx tsc -p tsconfig.json --noEmit`
Expected: `google-auth-library` installed; db built; zero TS errors.

- [ ] **Step 7: Commit.**

```bash
git add packages/google/package.json packages/google/tsconfig.json packages/google/tsconfig.scripts.json packages/google/vitest.config.ts packages/google/src/errors.ts package-lock.json
git commit -m "chore(google): scaffold @notreclaim/google package"
```

---

### Task 3: Config + token encryption

**Files:**
- Create: `packages/google/src/config.ts`
- Create: `packages/google/src/encryption.ts`
- Test: `packages/google/test/config.test.ts`, `packages/google/test/encryption.test.ts`

- [ ] **Step 1: Write the failing tests.**

`packages/google/test/encryption.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../src/encryption.js';

const key = Buffer.alloc(32, 7);

describe('token encryption', () => {
  it('round-trips plaintext and does not store it in the clear', () => {
    const ct = encryptToken('refresh-abc', key);
    expect(ct).not.toContain('refresh-abc');
    expect(decryptToken(ct, key)).toBe('refresh-abc');
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptToken('x', key)).not.toBe(encryptToken('x', key));
  });

  it('throws with the wrong key', () => {
    const ct = encryptToken('secret', key);
    expect(() => decryptToken(ct, Buffer.alloc(32, 9))).toThrow();
  });

  it('throws on tampered ciphertext', () => {
    const ct = encryptToken('secret', key);
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptToken(buf.toString('base64'), key)).toThrow();
  });
});
```

`packages/google/test/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { decodeEncryptionKey, loadGoogleConfig } from '../src/config.js';

describe('config', () => {
  it('decodes a valid 32-byte base64 key', () => {
    const raw = Buffer.alloc(32, 1).toString('base64');
    expect(decodeEncryptionKey(raw).length).toBe(32);
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => decodeEncryptionKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });

  it('loadGoogleConfig throws when a required var is missing', () => {
    expect(() => loadGoogleConfig({})).toThrow();
  });

  it('loadGoogleConfig returns a typed config when all vars are present', () => {
    const config = loadGoogleConfig({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:8123/oauth/callback',
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });
    expect(config.clientId).toBe('id');
    expect(config.encryptionKey.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/encryption.test.ts test/config.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `packages/google/src/encryption.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** AES-256-GCM encrypt; output packs iv | authTag | ciphertext as base64. */
export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Reverse of encryptToken. Throws on wrong key or tampered input. */
export function decryptToken(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
```

- [ ] **Step 4: Implement `packages/google/src/config.ts`**

```ts
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
}

/** Decode a base64 ENCRYPTION_KEY and assert it is exactly 32 bytes. */
export function decodeEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

/** Load and validate Google/encryption config from an environment record. */
export function loadGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  const encryptionKeyRaw = env.ENCRYPTION_KEY;

  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  if (!redirectUri) throw new Error('GOOGLE_REDIRECT_URI is not set');
  if (!encryptionKeyRaw) throw new Error('ENCRYPTION_KEY is not set');

  return { clientId, clientSecret, redirectUri, encryptionKey: decodeEncryptionKey(encryptionKeyRaw) };
}
```

- [ ] **Step 5: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/encryption.test.ts test/config.test.ts`
Expected: PASS (encryption 4, config 4).

- [ ] **Step 6: Commit.**

```bash
git add packages/google/src/config.ts packages/google/src/encryption.ts packages/google/test/config.test.ts packages/google/test/encryption.test.ts
git commit -m "feat(google): add config and AES-256-GCM token encryption"
```

---

### Task 4: `GoogleClient` interface + event types

**Files:**
- Create: `packages/google/src/client.ts`

No behavior test (types + interface only); verified by `tsc`.

- [ ] **Step 1: Write `packages/google/src/client.ts`**

```ts
/** Tokens returned by an OAuth code exchange. */
export interface GoogleTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  googleUserId: string;
  email: string;
}

export interface GoogleEventTime {
  dateTime?: string; // RFC3339, for timed events
  date?: string; // YYYY-MM-DD, for all-day events
}

export interface GoogleEvent {
  id: string;
  status: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary: string | null;
  start: GoogleEventTime | null;
  end: GoogleEventTime | null;
}

export interface ListEventsArgs {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  timeMin?: string; // RFC3339, used only on the initial full sync
}

export interface ListEventsResult {
  events: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** The seam everything mocks. */
export interface GoogleClient {
  getConsentUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  listEvents(args: ListEventsArgs): Promise<ListEventsResult>;
}
```

- [ ] **Step 2: Type-check.**
Run: `cd packages/google && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/google/src/client.ts
git commit -m "feat(google): add GoogleClient interface and event types"
```

---

### Task 5: Token service (+ test fakes)

**Files:**
- Create: `packages/google/src/token-service.ts`
- Create: `packages/google/test/fakes.ts`
- Test: `packages/google/test/token-service.test.ts`

- [ ] **Step 1: Create `packages/google/test/fakes.ts`** (Google client fake + user-repo fake + builders):

```ts
import type { User } from '@notreclaim/db';
import type {
  GoogleClient,
  GoogleTokens,
  ListEventsArgs,
  ListEventsResult,
} from '../src/client.js';
import { SyncTokenExpiredError } from '../src/errors.js';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'a@example.com',
    googleId: null,
    googleRefreshToken: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

/** Scriptable fake Google client. */
export class FakeGoogleClient implements GoogleClient {
  consentUrl = 'https://consent.example/auth';
  exchangeResult: GoogleTokens = {
    refreshToken: 'refresh-1',
    accessToken: 'access-initial',
    expiresAt: 0,
    googleUserId: 'g-123',
    email: 'a@example.com',
  };
  /** Queue of refresh responses (popped per refresh). */
  refreshResponses: Array<{ accessToken: string; expiresAt: number }> = [];
  /** Queue of listEvents responses; the string 'GONE' throws SyncTokenExpiredError. */
  listQueue: Array<ListEventsResult | 'GONE'> = [];
  refreshCalls = 0;
  exchangeCalls = 0;
  listCalls: ListEventsArgs[] = [];

  getConsentUrl(): string {
    return this.consentUrl;
  }

  async exchangeCode(): Promise<GoogleTokens> {
    this.exchangeCalls += 1;
    return this.exchangeResult;
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
    this.refreshCalls += 1;
    return this.refreshResponses.shift() ?? { accessToken: 'access-refreshed', expiresAt: 0 };
  }

  async listEvents(args: ListEventsArgs): Promise<ListEventsResult> {
    this.listCalls.push(args);
    const next = this.listQueue.shift();
    if (next === undefined) return { events: [] };
    if (next === 'GONE') throw new SyncTokenExpiredError();
    return next;
  }
}

/** In-memory UserRepository fake (the subset the token service uses). */
export function fakeUserRepo(seed: User[] = []) {
  const usersById = new Map<string, User>(seed.map((u) => [u.id, u]));
  let counter = seed.length;
  return {
    async findById(id: string): Promise<User | null> {
      return usersById.get(id) ?? null;
    },
    async findByGoogleId(googleId: string): Promise<User | null> {
      return [...usersById.values()].find((u) => u.googleId === googleId) ?? null;
    },
    async create(data: { email: string; googleId?: string | null }): Promise<User> {
      counter += 1;
      const user = makeUser({ id: `u${counter}`, email: data.email, googleId: data.googleId ?? null });
      usersById.set(user.id, user);
      return user;
    },
    async update(id: string, data: Partial<User>): Promise<User> {
      const existing = usersById.get(id);
      if (!existing) throw new Error(`user ${id} not found`);
      const updated = { ...existing, ...data };
      usersById.set(id, updated);
      return updated;
    },
  };
}
```

- [ ] **Step 2: Write the failing test `packages/google/test/token-service.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createTokenService } from '../src/token-service.js';
import { decryptToken } from '../src/encryption.js';
import { GoogleNotConnectedError } from '../src/errors.js';
import { FakeGoogleClient, fakeUserRepo, makeUser } from './fakes.js';

const key = Buffer.alloc(32, 5);

describe('TokenService', () => {
  it('connectFromCode stores an encrypted refresh token and identity', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo();
    const svc = createTokenService({ client, users, encryptionKey: key });

    const user = await svc.connectFromCode('the-code', 'http://localhost/cb');
    expect(user.googleId).toBe('g-123');
    expect(user.email).toBe('a@example.com');
    expect(user.googleRefreshToken).toBeTruthy();
    expect(user.googleRefreshToken).not.toBe('refresh-1'); // stored encrypted
    expect(decryptToken(user.googleRefreshToken!, key)).toBe('refresh-1');
  });

  it('getAccessToken refreshes, caches, and re-refreshes after expiry', async () => {
    const client = new FakeGoogleClient();
    client.refreshResponses = [
      { accessToken: 'a1', expiresAt: 5000 },
      { accessToken: 'a2', expiresAt: 9000 },
    ];
    const users = fakeUserRepo([
      makeUser({ id: 'u1', googleId: 'g-123', googleRefreshToken: undefined }),
    ]);
    // store an encrypted refresh token for u1
    const svc = createTokenService({ client, users, encryptionKey: key });
    await users.update('u1', { googleRefreshToken: (await import('../src/encryption.js')).encryptToken('refresh-1', key) });

    expect(await svc.getAccessToken('u1', 1000)).toBe('a1');
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 2000)).toBe('a1'); // cached
    expect(client.refreshCalls).toBe(1);
    expect(await svc.getAccessToken('u1', 6000)).toBe('a2'); // expired -> refresh
    expect(client.refreshCalls).toBe(2);
  });

  it('getAccessToken throws when the user has no refresh token', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo([makeUser({ id: 'u1', googleRefreshToken: null })]);
    const svc = createTokenService({ client, users, encryptionKey: key });
    await expect(svc.getAccessToken('u1', 1000)).rejects.toBeInstanceOf(GoogleNotConnectedError);
  });
});
```

- [ ] **Step 3: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/token-service.test.ts`
Expected: FAIL — cannot find module `../src/token-service.js`.

- [ ] **Step 4: Implement `packages/google/src/token-service.ts`**

```ts
import type { User, UserRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';
import { decryptToken, encryptToken } from './encryption.js';
import { GoogleNotConnectedError } from './errors.js';

export interface TokenServiceDeps {
  client: GoogleClient;
  users: Pick<UserRepository, 'findById' | 'findByGoogleId' | 'create' | 'update'>;
  encryptionKey: Buffer;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface TokenService {
  connectFromCode(code: string, redirectUri: string): Promise<User>;
  getAccessToken(userId: string, now: number): Promise<string>;
}

export function createTokenService(deps: TokenServiceDeps): TokenService {
  const cache = new Map<string, CachedToken>();

  return {
    async connectFromCode(code, redirectUri): Promise<User> {
      const tokens = await deps.client.exchangeCode(code, redirectUri);
      const encrypted = encryptToken(tokens.refreshToken, deps.encryptionKey);
      const existing = await deps.users.findByGoogleId(tokens.googleUserId);
      if (existing) {
        return deps.users.update(existing.id, {
          email: tokens.email,
          googleRefreshToken: encrypted,
        });
      }
      const created = await deps.users.create({ email: tokens.email, googleId: tokens.googleUserId });
      return deps.users.update(created.id, { googleRefreshToken: encrypted });
    },

    async getAccessToken(userId, now): Promise<string> {
      const cached = cache.get(userId);
      if (cached && cached.expiresAt > now) {
        return cached.accessToken;
      }
      const user = await deps.users.findById(userId);
      if (!user || !user.googleRefreshToken) {
        throw new GoogleNotConnectedError(userId);
      }
      const refreshToken = decryptToken(user.googleRefreshToken, deps.encryptionKey);
      const { accessToken, expiresAt } = await deps.client.refreshAccessToken(refreshToken);
      cache.set(userId, { accessToken, expiresAt });
      return accessToken;
    },
  };
}
```

- [ ] **Step 5: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/token-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit.**

```bash
git add packages/google/src/token-service.ts packages/google/test/fakes.ts packages/google/test/token-service.test.ts
git commit -m "feat(google): add TokenService with encrypted refresh token + cache"
```

---

### Task 6: Inbound sync engine

**Files:**
- Create: `packages/google/src/sync.ts`
- Modify: `packages/google/test/fakes.ts` (add repo fakes)
- Test: `packages/google/test/sync.test.ts`

- [ ] **Step 1: Append repo fakes to `packages/google/test/fakes.ts`**

```ts
import type { CalendarSyncState, UpsertSyncStateInput, UpsertCalendarEventInput } from '@notreclaim/db';

export function makeSyncState(over: Partial<CalendarSyncState> = {}): CalendarSyncState {
  return {
    id: 'ss1',
    userId: 'u1',
    googleCalendarId: 'primary',
    syncToken: null,
    lastSyncedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function fakeSyncStateRepo(initial: CalendarSyncState | null = null) {
  let state = initial;
  const upserts: UpsertSyncStateInput[] = [];
  return {
    async getByCalendar(): Promise<CalendarSyncState | null> {
      return state;
    },
    async upsert(userId: string, googleCalendarId: string, data: UpsertSyncStateInput): Promise<CalendarSyncState> {
      upserts.push(data);
      state = makeSyncState({ userId, googleCalendarId, syncToken: data.syncToken ?? null, lastSyncedAt: data.lastSyncedAt ?? null });
      return state;
    },
    upserts,
  };
}

export function fakeEventsRepo() {
  const upserted: UpsertCalendarEventInput[][] = [];
  const deleted: string[][] = [];
  return {
    async upsertMany(_userId: string, events: UpsertCalendarEventInput[]): Promise<void> {
      upserted.push(events);
    },
    async deleteByGoogleEventIds(_userId: string, ids: string[]): Promise<void> {
      deleted.push(ids);
    },
    upserted,
    deleted,
  };
}

/** Minimal access-token provider for sync tests. */
export function fakeTokenProvider(token = 'access-token') {
  return { async getAccessToken(): Promise<string> { return token; } };
}
```

- [ ] **Step 2: Write the failing test `packages/google/test/sync.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { syncPrimaryCalendar } from '../src/sync.js';
import {
  FakeGoogleClient,
  fakeSyncStateRepo,
  fakeEventsRepo,
  fakeTokenProvider,
  makeSyncState,
} from './fakes.js';

const timed = (id: string, start: string, end: string) => ({
  id, status: 'confirmed', summary: id, start: { dateTime: start }, end: { dateTime: end },
});
const allDay = (id: string, date: string) => ({
  id, status: 'confirmed', summary: id, start: { date }, end: { date },
});
const cancelled = (id: string) => ({ id, status: 'cancelled', summary: null, start: null, end: null });

function deps(client: FakeGoogleClient, state = null as Parameters<typeof fakeSyncStateRepo>[0]) {
  return {
    client,
    tokens: fakeTokenProvider(),
    syncState: fakeSyncStateRepo(state),
    events: fakeEventsRepo(),
  };
}

describe('syncPrimaryCalendar', () => {
  it('full sync: upserts timed events, skips all-day, stores the sync token', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{
      events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'), allDay('e2', '2026-01-06')],
      nextSyncToken: 'tok-next',
    }];
    const d = deps(client);
    const result = await syncPrimaryCalendar(d, 'u1', 1000);

    expect(result).toMatchObject({ upserted: 1, deleted: 0, fullResync: true });
    expect(d.events.upserted[0]).toEqual([{
      googleCalendarId: 'primary', googleEventId: 'e1', title: 'e1',
      startsAt: new Date('2026-01-05T09:00:00Z'), endsAt: new Date('2026-01-05T10:00:00Z'),
    }]);
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-next', lastSyncedAt: new Date(1000) });
    expect(client.listCalls[0]!.syncToken).toBeUndefined();
    expect(client.listCalls[0]!.timeMin).toBeTruthy();
  });

  it('incremental sync: applies upserts and deletes cancelled events', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [{
      events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z'), cancelled('e9')],
      nextSyncToken: 'tok-2',
    }];
    const d = deps(client, makeSyncState({ syncToken: 'tok-1' }));
    const result = await syncPrimaryCalendar(d, 'u1', 2000);

    expect(result).toMatchObject({ upserted: 1, deleted: 1, fullResync: false });
    expect(d.events.deleted[0]).toEqual(['e9']);
    expect(client.listCalls[0]!.syncToken).toBe('tok-1');
  });

  it('paginates across pages and keeps the final sync token', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [
      { events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextPageToken: 'p2' },
      { events: [timed('e2', '2026-01-06T09:00:00Z', '2026-01-06T10:00:00Z')], nextSyncToken: 'tok-final' },
    ];
    const d = deps(client);
    const result = await syncPrimaryCalendar(d, 'u1', 3000);

    expect(result.upserted).toBe(2);
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-final' });
    expect(client.listCalls).toHaveLength(2);
    expect(client.listCalls[1]!.pageToken).toBe('p2');
  });

  it('recovers from a 410 by doing a full resync', async () => {
    const client = new FakeGoogleClient();
    client.listQueue = [
      'GONE',
      { events: [timed('e1', '2026-01-05T09:00:00Z', '2026-01-05T10:00:00Z')], nextSyncToken: 'tok-fresh' },
    ];
    const d = deps(client, makeSyncState({ syncToken: 'stale' }));
    const result = await syncPrimaryCalendar(d, 'u1', 4000);

    expect(result).toMatchObject({ upserted: 1, fullResync: true });
    expect(client.listCalls[0]!.syncToken).toBe('stale'); // incremental attempt
    expect(client.listCalls[1]!.syncToken).toBeUndefined(); // full resync
    expect(client.listCalls[1]!.timeMin).toBeTruthy();
    expect(d.syncState.upserts[0]).toMatchObject({ syncToken: 'tok-fresh' });
  });
});
```

- [ ] **Step 2b: Run to verify failure.**
Run: `cd packages/google && npx vitest run test/sync.test.ts`
Expected: FAIL — cannot find module `../src/sync.js`.

- [ ] **Step 3: Implement `packages/google/src/sync.ts`**

```ts
import type {
  CalendarEventRepository,
  CalendarSyncStateRepository,
  UpsertCalendarEventInput,
} from '@notreclaim/db';
import type { GoogleClient, GoogleEvent, ListEventsArgs } from './client.js';
import { SyncTokenExpiredError } from './errors.js';

const PRIMARY = 'primary';

/** The token surface the sync engine needs. */
export interface AccessTokenProvider {
  getAccessToken(userId: string, now: number): Promise<string>;
}

export interface SyncDeps {
  client: GoogleClient;
  tokens: AccessTokenProvider;
  syncState: Pick<CalendarSyncStateRepository, 'getByCalendar' | 'upsert'>;
  events: Pick<CalendarEventRepository, 'upsertMany' | 'deleteByGoogleEventIds'>;
}

export interface SyncResult {
  upserted: number;
  deleted: number;
  fullResync: boolean;
}

function startOfTodayUtcIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

async function collectPages(
  client: GoogleClient,
  baseArgs: ListEventsArgs,
): Promise<{ events: GoogleEvent[]; nextSyncToken?: string }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  do {
    const res = await client.listEvents({ ...baseArgs, pageToken });
    events.push(...res.events);
    pageToken = res.nextPageToken;
    if (res.nextSyncToken) nextSyncToken = res.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken };
}

/** Sync the user's primary calendar into CalendarEvent rows. */
export async function syncPrimaryCalendar(deps: SyncDeps, userId: string, now: number): Promise<SyncResult> {
  const accessToken = await deps.tokens.getAccessToken(userId, now);
  const state = await deps.syncState.getByCalendar(userId, PRIMARY);

  const fullArgs: ListEventsArgs = { accessToken, calendarId: PRIMARY, timeMin: startOfTodayUtcIso(now) };
  let fullResync = false;
  let collected: { events: GoogleEvent[]; nextSyncToken?: string };

  try {
    if (state?.syncToken) {
      collected = await collectPages(deps.client, { accessToken, calendarId: PRIMARY, syncToken: state.syncToken });
    } else {
      fullResync = true;
      collected = await collectPages(deps.client, fullArgs);
    }
  } catch (error) {
    if (error instanceof SyncTokenExpiredError) {
      fullResync = true;
      collected = await collectPages(deps.client, fullArgs);
    } else {
      throw error;
    }
  }

  const toUpsert: UpsertCalendarEventInput[] = [];
  const toDelete: string[] = [];
  for (const ev of collected.events) {
    if (ev.status === 'cancelled') {
      toDelete.push(ev.id);
      continue;
    }
    if (!ev.start?.dateTime || !ev.end?.dateTime) continue; // skip all-day / malformed
    toUpsert.push({
      googleCalendarId: PRIMARY,
      googleEventId: ev.id,
      title: ev.summary ?? '(no title)',
      startsAt: new Date(ev.start.dateTime),
      endsAt: new Date(ev.end.dateTime),
    });
  }

  if (toUpsert.length > 0) await deps.events.upsertMany(userId, toUpsert);
  if (toDelete.length > 0) await deps.events.deleteByGoogleEventIds(userId, toDelete);

  await deps.syncState.upsert(userId, PRIMARY, {
    syncToken: collected.nextSyncToken ?? null,
    lastSyncedAt: new Date(now),
  });

  return { upserted: toUpsert.length, deleted: toDelete.length, fullResync };
}
```

- [ ] **Step 4: Run to verify pass.**
Run: `cd packages/google && npx vitest run test/sync.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/google/src/sync.ts packages/google/test/fakes.ts packages/google/test/sync.test.ts
git commit -m "feat(google): add inbound primary-calendar sync engine"
```

---

### Task 7: Real Google client adapter

**Files:**
- Create: `packages/google/src/google-client.ts`

Thin real adapter (no live network in tests; verified by build/typecheck).

- [ ] **Step 1: Write `packages/google/src/google-client.ts`**

```ts
import { OAuth2Client } from 'google-auth-library';
import type { GoogleClient, GoogleEvent, GoogleTokens, ListEventsArgs, ListEventsResult } from './client.js';
import { GoogleApiError, GoogleAuthError, SyncTokenExpiredError } from './errors.js';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar'];
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
}

interface RawGoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

function mapEvent(item: RawGoogleEvent): GoogleEvent {
  return {
    id: item.id,
    status: item.status ?? 'confirmed',
    summary: item.summary ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
  };
}

/** Real GoogleClient backed by google-auth-library (OAuth) and fetch (Calendar REST). */
export function createGoogleClient(config: GoogleClientConfig): GoogleClient {
  const oauth = (redirectUri?: string) =>
    new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret, redirectUri });

  return {
    getConsentUrl(redirectUri, state) {
      return oauth(redirectUri).generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
        ...(state ? { state } : {}),
      });
    },

    async exchangeCode(code, redirectUri): Promise<GoogleTokens> {
      const client = oauth(redirectUri);
      const { tokens } = await client.getToken(code);
      if (!tokens.refresh_token || !tokens.access_token || !tokens.id_token) {
        throw new GoogleAuthError('Incomplete token response from Google');
      }
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new GoogleAuthError('Missing identity in id_token');
      }
      return {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresAt: tokens.expiry_date ?? 0,
        googleUserId: payload.sub,
        email: payload.email,
      };
    },

    async refreshAccessToken(refreshToken) {
      const client = oauth();
      client.setCredentials({ refresh_token: refreshToken });
      try {
        const { credentials } = await client.refreshAccessToken();
        if (!credentials.access_token) throw new GoogleAuthError('No access token after refresh');
        return { accessToken: credentials.access_token, expiresAt: credentials.expiry_date ?? 0 };
      } catch (error) {
        throw new GoogleAuthError(error instanceof Error ? error.message : 'Token refresh failed');
      }
    },

    async listEvents({ accessToken, calendarId, syncToken, pageToken, timeMin }: ListEventsArgs): Promise<ListEventsResult> {
      const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      if (syncToken) {
        url.searchParams.set('syncToken', syncToken);
      } else if (timeMin) {
        url.searchParams.set('timeMin', timeMin);
      }
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.status === 410) throw new SyncTokenExpiredError();
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());

      const data = (await res.json()) as {
        items?: RawGoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      return {
        events: (data.items ?? []).map(mapEvent),
        nextPageToken: data.nextPageToken,
        nextSyncToken: data.nextSyncToken,
      };
    },
  };
}
```

- [ ] **Step 2: Type-check and build.**
Run: `cd packages/google && npx tsc -p tsconfig.json --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/google/src/google-client.ts
git commit -m "feat(google): add real google-auth-library + fetch adapter"
```

---

### Task 8: One-time consent script

**Files:**
- Create: `packages/google/scripts/connect.ts`

Manual tool; verified by `tsconfig.scripts.json` typecheck only.

- [ ] **Step 1: Write `packages/google/scripts/connect.ts`**

```ts
import http from 'node:http';
import { prisma, createUserRepository } from '@notreclaim/db';
import { loadGoogleConfig } from '../src/config.js';
import { createGoogleClient } from '../src/google-client.js';
import { createTokenService } from '../src/token-service.js';

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  const client = createGoogleClient({ clientId: config.clientId, clientSecret: config.clientSecret });
  const users = createUserRepository(prisma);
  const tokens = createTokenService({ client, users, encryptionKey: config.encryptionKey });

  const redirect = new URL(config.redirectUri);
  const port = Number(redirect.port || '80');

  const server = http.createServer((req, res) => {
    void (async () => {
      const reqUrl = new URL(req.url ?? '/', config.redirectUri);
      const code = reqUrl.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing ?code');
        return;
      }
      try {
        const user = await tokens.connectFromCode(code, config.redirectUri);
        res.writeHead(200);
        res.end(`Connected as ${user.email}. You can close this tab.`);
        console.log(`Connected user ${user.id} (${user.email}).`);
      } catch (error) {
        res.writeHead(500);
        res.end('Error connecting; check the server log.');
        console.error(error);
      } finally {
        server.close();
        await prisma.$disconnect();
      }
    })();
  });

  server.listen(port, () => {
    console.log('Open this URL in your browser to grant access:\n');
    console.log(client.getConsentUrl(config.redirectUri));
  });
}

void main();
```

- [ ] **Step 2: Type-check the script (build deps first).**
Run: `npm run build -w @notreclaim/db && cd packages/google && npm run typecheck:scripts`
Expected: zero errors.

- [ ] **Step 3: Commit.**

```bash
git add packages/google/scripts/connect.ts
git commit -m "feat(google): add one-time CLI consent script"
```

---

### Task 9: Public exports and full verification

**Files:**
- Create: `packages/google/src/index.ts`

- [ ] **Step 1: Write `packages/google/src/index.ts`**

```ts
export {
  GoogleNotConnectedError,
  SyncTokenExpiredError,
  GoogleApiError,
  GoogleAuthError,
} from './errors.js';
export { loadGoogleConfig, decodeEncryptionKey } from './config.js';
export type { GoogleConfig } from './config.js';
export { encryptToken, decryptToken } from './encryption.js';
export type {
  GoogleClient,
  GoogleTokens,
  GoogleEvent,
  GoogleEventTime,
  ListEventsArgs,
  ListEventsResult,
} from './client.js';
export { createGoogleClient } from './google-client.js';
export type { GoogleClientConfig } from './google-client.js';
export { createTokenService } from './token-service.js';
export type { TokenService, TokenServiceDeps } from './token-service.js';
export { syncPrimaryCalendar } from './sync.js';
export type { SyncDeps, SyncResult, AccessTokenProvider } from './sync.js';
```

- [ ] **Step 2: Run the full package suite.**
Run: `cd packages/google && npx vitest run`
Expected: PASS — encryption 4, config 4, token-service 3, sync 4 = 15 tests.

- [ ] **Step 3: Build the package + typecheck the script.**
Run: `cd packages/google && npm run build && npm run typecheck:scripts`
Expected: compiles to `dist/`; `dist/index.js` and `dist/index.d.ts` exist; script typecheck clean.

- [ ] **Step 4: Run the whole monorepo suite (Postgres must be running for db).**
Run: `cd /home/nyx-ai/Projects/NotReclaim && npm test`
Expected: scheduler 28, db 31, core 22, google 15 — all pass.

- [ ] **Step 5: Commit.**

```bash
git add packages/google/src/index.ts
git commit -m "feat(google): add public exports"
```

---

## Self-Review Notes

- **Spec coverage:** `CalendarSyncState` table + repo (Task 1) · package scaffold + typed errors (Task 2) · config with 32-byte `ENCRYPTION_KEY` validation + AES-256-GCM encryption (Task 3) · `GoogleClient` interface + event types (Task 4) · `TokenService` connectFromCode (encrypted storage) + getAccessToken (inject `now`, cache, refresh, not-connected error) (Task 5) · inbound `syncPrimaryCalendar` full + incremental + 410 recovery + upsert-timed + delete-cancelled + skip-all-day + persist token (Task 6) · real `createGoogleClient` adapter throwing `SyncTokenExpiredError` on 410 / `GoogleApiError` otherwise (Task 7) · one-time consent script (Task 8) · exports (Task 9). All tests DB-free except the `CalendarSyncStateRepository` integration tests. Non-goals (write-back, reconcile orchestrator, conflict/pin, HTTP routes/webhook/timer) are absent.
- **Type consistency:** `GoogleClient`/`GoogleEvent`/`GoogleTokens`/`ListEventsArgs`/`ListEventsResult` defined in Task 4 are used identically by the fake (Task 5), sync engine (Task 6), and real adapter (Task 7). `SyncDeps` uses `Pick<>` of the db repo interfaces (Task 6); `AccessTokenProvider` is satisfied structurally by `TokenService.getAccessToken` (Task 5). `UpsertCalendarEventInput`/`UpsertSyncStateInput`/`CalendarSyncState`/`User`/`UserRepository`/`CalendarEventRepository`/`CalendarSyncStateRepository` all come from `@notreclaim/db`.
- **No placeholders:** every code/test step is complete.
- **Determinism / safety:** `now` injected into `getAccessToken` and `syncPrimaryCalendar`; the only randomness is the AES IV (`crypto.randomBytes`, correct). `startOfTodayUtcIso` uses `new Date(now)` (explicit arg), not `Date.now`.
- **Cross-package build order:** Task 1 rebuilds `@notreclaim/db` so `@notreclaim/google` resolves the new `CalendarSyncState`/repo types; the whole-suite run (Task 9) expects db at 31 tests (27 prior + 4 new).
```
