# Multi-User Auth — Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NotReclaim a true multi-user app with two full auth methods — email+password and Google — gated by `REGISTRATION_MODE`, with accounts anchored to their own UUID (Google is linkable, not identity), plus first-run defaults, data-isolation hardening, and an admin CLI.

**Architecture:** Additive on top of the existing per-user JWT design. Identity stays the `User.id` UUID + email; add nullable `passwordHash` + `isAdmin` + an `InviteCode` table. Reuse the existing `@fastify/jwt` `{ sub }` token and the `authenticate` decorator for sessions. Password hashing via `@node-rs/argon2` (prebuilt binaries → no native toolchain in the deploy image). The Google callback is reworked from "always create by googleId" into a gated resolver (login / link-by-email / gated-create) driven by `REGISTRATION_MODE` and a signed OAuth `state`.

**Tech Stack:** TypeScript ESM, Fastify 4, `@fastify/jwt` 8, Prisma 5 (PostgreSQL), Zod, Vitest, React + Tailwind, React Router, TanStack Query.

**Conventions (apply to every task):**
- Tests run **per package** (`cd packages/<pkg> && npm test`). DB & server tests need a Postgres test DB — copy `packages/db/.env.test.example` → `packages/db/.env.test` and run migrations against `TEST_DATABASE_URL` once before starting (`cd packages/db && npx prisma migrate deploy` with `DATABASE_URL=$TEST_DATABASE_URL`). **Web tests need `TZ=UTC`** (`cd packages/web && TZ=UTC npm test`).
- Commit steps use `git add <specific files>` — **never** `git add -A`, never stage `*.tsbuildinfo` / `.env*`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Order is dependency-safe: the suite stays green after every task.

---

### Task 1: Schema — `passwordHash`, `isAdmin`, `InviteCode`

**Files:**
- Modify: `packages/db/prisma/schema.prisma:28-44` (User model) and append a new model
- Create: `packages/db/prisma/migrations/<timestamp>_multi_user_auth/migration.sql` (generated)

- [ ] **Step 1: Edit the `User` model** — add two columns after `googleRefreshToken` (line 32):

```prisma
model User {
  id                 String   @id @default(uuid())
  email              String   @unique
  passwordHash             String?
  isAdmin                  Boolean  @default(false)
  googleId           String?  @unique
  googleRefreshToken       String?
  autoScheduledCalendarId  String?
  createdAt                DateTime @default(now()) @db.Timestamptz
  updatedAt          DateTime @updatedAt @db.Timestamptz

  settings            Settings?
  calendarEvents      CalendarEvent[]
  tasks               Task[]
  habits              Habit[]
  categories          Category[]
  scheduledBlocks     ScheduledBlock[]
  calendarSyncStates  CalendarSyncState[]
  invitesCreated      InviteCode[]
}
```

- [ ] **Step 2: Append the `InviteCode` model** at the end of the file:

```prisma
model InviteCode {
  id              String    @id @default(uuid())
  code            String    @unique
  email           String?
  maxUses         Int       @default(1)
  usedCount       Int       @default(0)
  expiresAt       DateTime? @db.Timestamptz
  createdByUserId String
  createdAt       DateTime  @default(now()) @db.Timestamptz

  createdBy User @relation(fields: [createdByUserId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 3: Generate the migration and client.**

Run (dev DB must be up — see [[local-postgres]]):
```bash
cd packages/db && npx prisma migrate dev --name multi_user_auth
```
Expected: a new `migrations/<ts>_multi_user_auth/` folder is created, client regenerates, "Your database is now in sync".

- [ ] **Step 4: Apply to the test DB and run db tests.**

Run:
```bash
cd packages/db && DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy && npm test
```
Expected: migrate deploy applies `multi_user_auth`; all existing db tests PASS (the new columns are nullable/defaulted, so nothing breaks).

- [ ] **Step 5: Commit.**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add passwordHash, isAdmin, and InviteCode to schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: UserRepository — password/email/admin fields

**Files:**
- Modify: `packages/db/src/repositories/user-repository.ts:4-14` (inputs), `:46-57` (update read fix)
- Test: `packages/db/test/repositories/user-repository.test.ts`

- [ ] **Step 1: Write failing tests** — append inside the `describe('UserRepository', …)` block in `user-repository.test.ts`:

```ts
  it('creates a user with a passwordHash and isAdmin', async () => {
    const user = await repo.create({ email: 'pw@example.com', passwordHash: 'argon$hash', isAdmin: true });
    const found = await repo.findById(user.id);
    expect(found?.passwordHash).toBe('argon$hash');
    expect(found?.isAdmin).toBe(true);
  });

  it('sets a passwordHash on an existing user via update', async () => {
    const user = await repo.create({ email: 'set@example.com' });
    expect(user.passwordHash).toBeNull();
    const updated = await repo.update(user.id, { passwordHash: 'new$hash' });
    expect(updated.passwordHash).toBe('new$hash');
  });
```

- [ ] **Step 2: Run, expect FAIL** (type error / passwordHash not accepted).
```bash
cd packages/db && npm test -- user-repository
```
Expected: FAIL (TS rejects `passwordHash`/`isAdmin` on the input types).

- [ ] **Step 3: Extend the input types** in `user-repository.ts`:

```ts
export interface CreateUserInput {
  email: string;
  googleId?: string | null;
  passwordHash?: string | null;
  isAdmin?: boolean;
}

export interface UpdateUserInput {
  email?: string;
  googleId?: string | null;
  googleRefreshToken?: string | null;
  autoScheduledCalendarId?: string | null;
  passwordHash?: string | null;
  isAdmin?: boolean;
}
```

- [ ] **Step 4: Harden the `update` read** — change line 52 so the post-write read re-checks identity (the row is keyed by its own id here, so this is consistency, not isolation, but keep it uniform):

```ts
    async update(id: string, data: UpdateUserInput): Promise<User> {
      try {
        const result = await prisma.user.updateMany({ where: { id }, data });
        if (result.count === 0) {
          throw new NotFoundError(`User ${id} not found`);
        }
        return await prisma.user.findUniqueOrThrow({ where: { id } });
      } catch (error) {
        if (error instanceof NotFoundError) throw error;
        translatePrismaError(error);
      }
    },
```
(No functional change needed here — `create`/`update` already pass `data` straight through, so the new optional fields flow automatically once the types accept them.)

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/db && npm test -- user-repository
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/db/src/repositories/user-repository.ts packages/db/test/repositories/user-repository.test.ts
git commit -m "feat(db): user repo accepts passwordHash and isAdmin

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: InviteCodeRepository

**Files:**
- Create: `packages/db/src/repositories/invite-code-repository.ts`
- Modify: `packages/db/src/index.ts:23-24` (exports)
- Test: `packages/db/test/repositories/invite-code-repository.test.ts`
- Modify: `packages/db/test/setup-each.ts:4-13` (truncate the new table)

- [ ] **Step 1: Add `InviteCode` to the truncate list** in `setup-each.ts` (top of `TABLES`, before `User` is fine since FK is to User — put it first):

```ts
const TABLES = [
  'InviteCode',
  'Subtask',
  'ScheduledBlock',
  'CalendarEvent',
  'Task',
  'Category',
  'Habit',
  'Settings',
  'User',
];
```

- [ ] **Step 2: Write failing tests** — `invite-code-repository.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../../src/client.js';
import { createUserRepository } from '../../src/repositories/user-repository.js';
import { createInviteCodeRepository } from '../../src/repositories/invite-code-repository.js';

const users = createUserRepository(prisma);
const repo = createInviteCodeRepository(prisma);

async function admin() {
  return users.create({ email: `admin-${Math.random()}@x.com`, isAdmin: true });
}

describe('InviteCodeRepository', () => {
  it('creates a code and finds it', async () => {
    const a = await admin();
    const inv = await repo.create({ code: 'ABC123', createdByUserId: a.id });
    expect(inv.maxUses).toBe(1);
    expect(inv.usedCount).toBe(0);
    expect(await repo.findByCode('ABC123')).toMatchObject({ id: inv.id });
    expect(await repo.findByCode('nope')).toBeNull();
  });

  it('validates: rejects unknown, exhausted, expired, and email-mismatched codes', async () => {
    const a = await admin();
    await repo.create({ code: 'OPEN', createdByUserId: a.id, maxUses: 2 });
    await repo.create({ code: 'USED', createdByUserId: a.id, maxUses: 1, usedCount: 1 });
    await repo.create({ code: 'OLD', createdByUserId: a.id, expiresAt: new Date('2000-01-01T00:00:00Z') });
    await repo.create({ code: 'BOUND', createdByUserId: a.id, email: 'only@x.com' });
    const now = new Date('2026-06-18T00:00:00Z');
    expect(await repo.validate('OPEN', 'anyone@x.com', now)).toBe(true);
    expect(await repo.validate('MISSING', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('USED', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('OLD', 'anyone@x.com', now)).toBe(false);
    expect(await repo.validate('BOUND', 'other@x.com', now)).toBe(false);
    expect(await repo.validate('BOUND', 'only@x.com', now)).toBe(true);
  });

  it('consume increments usedCount and is reflected in validate', async () => {
    const a = await admin();
    await repo.create({ code: 'ONE', createdByUserId: a.id, maxUses: 1 });
    const now = new Date('2026-06-18T00:00:00Z');
    expect(await repo.validate('ONE', 'a@x.com', now)).toBe(true);
    await repo.consume('ONE');
    expect(await repo.validate('ONE', 'a@x.com', now)).toBe(false);
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (module not found).
```bash
cd packages/db && npm test -- invite-code
```
Expected: FAIL.

- [ ] **Step 4: Implement** `invite-code-repository.ts`:

```ts
import type { PrismaClient, InviteCode } from '@prisma/client';
import { translatePrismaError } from '../errors.js';

export interface CreateInviteCodeInput {
  code: string;
  createdByUserId: string;
  email?: string | null;
  maxUses?: number;
  usedCount?: number;
  expiresAt?: Date | null;
}

export function createInviteCodeRepository(prisma: PrismaClient) {
  return {
    async create(data: CreateInviteCodeInput): Promise<InviteCode> {
      try {
        return await prisma.inviteCode.create({ data });
      } catch (error) {
        translatePrismaError(error);
      }
    },

    findByCode(code: string): Promise<InviteCode | null> {
      return prisma.inviteCode.findUnique({ where: { code } });
    },

    /** True when the code exists, is unexpired, not exhausted, and (if email-bound) matches. */
    async validate(code: string, email: string, now: Date): Promise<boolean> {
      const inv = await prisma.inviteCode.findUnique({ where: { code } });
      if (!inv) return false;
      if (inv.expiresAt && inv.expiresAt <= now) return false;
      if (inv.usedCount >= inv.maxUses) return false;
      if (inv.email && inv.email.toLowerCase() !== email.toLowerCase()) return false;
      return true;
    },

    async consume(code: string): Promise<void> {
      await prisma.inviteCode.update({ where: { code }, data: { usedCount: { increment: 1 } } });
    },
  };
}

export type InviteCodeRepository = ReturnType<typeof createInviteCodeRepository>;
```

- [ ] **Step 5: Export it** — append to `packages/db/src/index.ts`:

```ts
export { createInviteCodeRepository } from './repositories/invite-code-repository.js';
export type { InviteCodeRepository, CreateInviteCodeInput } from './repositories/invite-code-repository.js';
```
and add `InviteCode` to the `@prisma/client` re-export type list (line 29-43).

- [ ] **Step 6: Run, expect PASS.**
```bash
cd packages/db && npm test -- invite-code
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/db/src/repositories/invite-code-repository.ts packages/db/src/index.ts packages/db/test/repositories/invite-code-repository.test.ts packages/db/test/setup-each.ts
git commit -m "feat(db): InviteCodeRepository (create/find/validate/consume)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Password module (argon2id)

**Files:**
- Modify: `packages/server/package.json:24-31` (add dependency)
- Create: `packages/server/src/auth/password.ts`
- Test: `packages/server/test/password.test.ts`

- [ ] **Step 1: Add the dependency** to `packages/server/package.json` `dependencies` and install:
```bash
cd packages/server && npm install @node-rs/argon2@^2.0.2
```
Expected: `@node-rs/argon2` added (prebuilt binary, no compiler needed).

- [ ] **Step 2: Write failing test** — `packages/server/test/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password', () => {
  it('hashes to something that is not the plaintext', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h).not.toBe('correct horse battery staple');
    expect(h.length).toBeGreaterThan(20);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const h = await hashPassword('s3cret-passw0rd');
    expect(await verifyPassword(h, 's3cret-passw0rd')).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('verifyPassword returns false on a malformed hash instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'whatever')).toBe(false);
  });
});
```

- [ ] **Step 3: Run, expect FAIL.**
```bash
cd packages/server && npm test -- password
```
Expected: FAIL (module not found).

- [ ] **Step 4: Implement** `packages/server/src/auth/password.ts`:

```ts
import { hash, verify } from '@node-rs/argon2';

/** Argon2id with library defaults (memory/time costs tuned for interactive logins). */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/server && npm test -- password
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/server/package.json packages/server/package-lock.json packages/server/src/auth/password.ts packages/server/test/password.test.ts
git commit -m "feat(server): argon2id password hashing module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(If the lockfile lives at the repo root, add the root `package-lock.json` instead.)

---

### Task 5: `ensureUserDefaults` service + helpers

**Files:**
- Create: `packages/server/src/auth/user-defaults.ts`
- Create: `packages/server/src/auth/email.ts`
- Test: `packages/server/test/user-defaults.test.ts`

- [ ] **Step 1: Write failing test** — `packages/server/test/user-defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ensureUserDefaults } from '../src/auth/user-defaults.js';
import { normalizeEmail } from '../src/auth/email.js';
import { fakeSettingsRepo } from './fakes.js';

describe('ensureUserDefaults', () => {
  it('creates a Settings row when none exists', async () => {
    const settings = fakeSettingsRepo(null);
    await ensureUserDefaults(settings, 'u1', 'America/New_York');
    const row = await settings.getByUserId('u1');
    expect(row?.timezone).toBe('America/New_York');
    expect(row?.horizonDays).toBe(14);
    expect((row?.workingHours as unknown as Array<{ weekday: number }>).length).toBe(5);
  });

  it('does not overwrite existing settings', async () => {
    const settings = fakeSettingsRepo({
      id: 's', userId: 'u1', timezone: 'Europe/Paris', workingHours: [],
      horizonDays: 7, defaultMinChunkMs: 1, defaultMaxChunkMs: 2,
      meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false,
      createdAt: new Date(0), updatedAt: new Date(0),
    } as never);
    await ensureUserDefaults(settings, 'u1');
    const row = await settings.getByUserId('u1');
    expect(row?.timezone).toBe('Europe/Paris');
    expect(row?.horizonDays).toBe(7);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/server && npm test -- user-defaults
```
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `packages/server/src/auth/email.ts`:

```ts
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}
```

- [ ] **Step 4: Implement** `packages/server/src/auth/user-defaults.ts`:

```ts
import type { SettingsRepository } from '@notreclaim/db';

/** Mon–Fri 09:00–17:00 — matches the dev seed defaults. */
const DEFAULT_WORKING_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday, startMinute: 540, endMinute: 1020,
}));

/** Create a Settings row for a brand-new account so the planner is usable immediately. */
export async function ensureUserDefaults(
  settings: Pick<SettingsRepository, 'getByUserId' | 'upsert'>,
  userId: string,
  timezone = 'UTC',
): Promise<void> {
  const existing = await settings.getByUserId(userId);
  if (existing) return;
  await settings.upsert(userId, {
    timezone,
    workingHours: DEFAULT_WORKING_HOURS as unknown as import('@notreclaim/db').Prisma.InputJsonValue,
    horizonDays: 14,
    defaultMinChunkMs: 1_800_000,
    defaultMaxChunkMs: 7_200_000,
  });
}
```

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/server && npm test -- user-defaults
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/server/src/auth/user-defaults.ts packages/server/src/auth/email.ts packages/server/test/user-defaults.test.ts
git commit -m "feat(server): ensureUserDefaults + email helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Config — `REGISTRATION_MODE` + JWT TTL

**Files:**
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/src/auth/token.ts`
- Test: `packages/server/test/config.test.ts`

- [ ] **Step 1: Write failing tests** — append to `packages/server/test/config.test.ts`:

```ts
  it('defaults REGISTRATION_MODE to closed and validates the value', () => {
    expect(loadServerConfig({ JWT_SECRET: 's' }).registrationMode).toBe('closed');
    expect(loadServerConfig({ JWT_SECRET: 's', REGISTRATION_MODE: 'open' }).registrationMode).toBe('open');
    expect(() => loadServerConfig({ JWT_SECRET: 's', REGISTRATION_MODE: 'bogus' })).toThrow();
  });
```
(Ensure `loadServerConfig` is imported at the top of the file.)

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/server && npm test -- config
```
Expected: FAIL.

- [ ] **Step 3: Implement** — edit `packages/server/src/config.ts`:

```ts
export type RegistrationMode = 'closed' | 'invite' | 'open';

export interface ServerConfig {
  port: number;
  jwtSecret: string;
  pollIntervalMs: number;
  webClientUrl?: string;
  registrationMode: RegistrationMode;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${env.PORT}`);
  const pollIntervalMs = env.POLL_INTERVAL_MS ? Number(env.POLL_INTERVAL_MS) : 300000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`Invalid POLL_INTERVAL_MS: ${env.POLL_INTERVAL_MS}`);
  }
  const webClientUrl = env.WEB_CLIENT_URL ? env.WEB_CLIENT_URL.replace(/\/$/, '') : undefined;
  const registrationMode = (env.REGISTRATION_MODE ?? 'closed') as RegistrationMode;
  if (!['closed', 'invite', 'open'].includes(registrationMode)) {
    throw new Error(`Invalid REGISTRATION_MODE: ${env.REGISTRATION_MODE}`);
  }
  return { port, jwtSecret, pollIntervalMs, webClientUrl, registrationMode };
}
```

- [ ] **Step 4: Create the token helper** `packages/server/src/auth/token.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export const TOKEN_TTL = '30d';

/** Sign a 30-day session token for a user id. */
export function signSession(app: FastifyInstance, userId: string): string {
  return app.jwt.sign({ sub: userId }, { expiresIn: TOKEN_TTL });
}
```

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/server && npm test -- config
```
Expected: PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/server/src/config.ts packages/server/src/auth/token.ts packages/server/test/config.test.ts
git commit -m "feat(server): REGISTRATION_MODE config + 30d session token helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Wire new deps (`repos.users`, `repos.invites`, `config.registrationMode`, `tokens.exchangeCodeForLink`)

This task adds plumbing only — no endpoint behavior changes yet; the suite stays green.

**Files:**
- Modify: `packages/google/src/token-service.ts` (add `exchangeCodeForLink`)
- Modify: `packages/google/test/token-service.test.ts` (cover it)
- Modify: `packages/server/src/app.ts:28-47` (AppDeps), `:45` (config)
- Modify: `packages/server/src/server.ts:60-71` (composition root)
- Modify: `packages/server/test/fakes.ts` (fake users/invites repos + `exchangeCodeForLink` + options)

- [ ] **Step 1: Write failing test** — append to `packages/google/test/token-service.test.ts`:

```ts
  it('exchangeCodeForLink returns profile + encrypted refresh token without writing a user', async () => {
    const client = new FakeGoogleClient();
    const users = fakeUserRepo();
    const svc = createTokenService({ client, users, encryptionKey: key });
    const out = await svc.exchangeCodeForLink('code', 'http://localhost/cb');
    expect(out.email).toBe('a@example.com');
    expect(out.googleUserId).toBe('g-123');
    expect(decryptToken(out.encryptedRefreshToken, key)).toBe('refresh-1');
    expect(await users.findByGoogleId('g-123')).toBeNull(); // no DB write
  });
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/google && npm test -- token-service
```
Expected: FAIL.

- [ ] **Step 3: Implement `exchangeCodeForLink`** in `packages/google/src/token-service.ts` — extend the interface and the returned object:

```ts
export interface TokenService {
  connectFromCode(code: string, redirectUri: string): Promise<User>;
  exchangeCodeForLink(
    code: string,
    redirectUri: string,
  ): Promise<{ email: string; googleUserId: string; encryptedRefreshToken: string }>;
  getAccessToken(userId: string, now: number): Promise<string>;
}
```
and inside `createTokenService`'s returned object add:

```ts
    async exchangeCodeForLink(code, redirectUri) {
      const tokens = await deps.client.exchangeCode(code, redirectUri);
      return {
        email: tokens.email,
        googleUserId: tokens.googleUserId,
        encryptedRefreshToken: encryptToken(tokens.refreshToken, deps.encryptionKey),
      };
    },
```

- [ ] **Step 4: Run, expect PASS.**
```bash
cd packages/google && npm test -- token-service
```
Expected: PASS.

- [ ] **Step 5: Extend `AppDeps`** in `packages/server/src/app.ts`:
  - Add imports for `UserRepository`, `InviteCodeRepository` from `@notreclaim/db` and `RegistrationMode` from `./config.js`.
  - In `repos`, add:
    ```ts
    users: Pick<UserRepository, 'findById' | 'findByEmail' | 'findByGoogleId' | 'create' | 'update'>;
    invites: Pick<InviteCodeRepository, 'validate' | 'consume'>;
    ```
  - In `google.tokens` Pick, add `'exchangeCodeForLink'`:
    ```ts
    tokens: Pick<TokenService, 'connectFromCode' | 'exchangeCodeForLink' | 'getAccessToken'>;
    ```
  - In `config`, add `registrationMode: RegistrationMode;`.

- [ ] **Step 6: Wire the composition root** `packages/server/src/server.ts`:
  - `const invites = createInviteCodeRepository(prisma);` (import `createInviteCodeRepository`).
  - In `buildApp({ repos: { … } })` add `users, invites`.
  - In `config: { … }` add `registrationMode: serverConfig.registrationMode`.

- [ ] **Step 7: Update the test harness** `packages/server/test/fakes.ts`:
  - Add a `fakeUserRepo` and `fakeInviteRepo`:

```ts
export function fakeUserRepo(seed: User[] = []) {
  const byId = new Map<string, User>(seed.map((u) => [u.id, u]));
  let n = seed.length;
  const make = (data: Partial<User>): User => ({
    id: `u${++n}`, email: '', passwordHash: null, isAdmin: false, googleId: null,
    googleRefreshToken: null, autoScheduledCalendarId: null,
    createdAt: new Date(0), updatedAt: new Date(0), ...data,
  } as User);
  return {
    async findById(id: string) { return byId.get(id) ?? null; },
    async findByEmail(email: string) { return [...byId.values()].find((u) => u.email === email) ?? null; },
    async findByGoogleId(googleId: string) { return [...byId.values()].find((u) => u.googleId === googleId) ?? null; },
    async create(data: Partial<User>) { const u = make(data); byId.set(u.id, u); return u; },
    async update(id: string, data: Partial<User>) {
      const u = byId.get(id); if (!u) { const { NotFoundError } = await import('@notreclaim/db'); throw new NotFoundError(`User ${id}`); }
      Object.assign(u, data); return u;
    },
    _all: byId,
  };
}

export function fakeInviteRepo(opts: { valid?: Set<string> } = {}) {
  const consumed: string[] = [];
  const valid = opts.valid ?? new Set<string>();
  return {
    async validate(code: string) { return valid.has(code); },
    async consume(code: string) { consumed.push(code); valid.delete(code); },
    consumed,
  };
}
```
  - In `TestAppOptions` add `users?: User[]; registrationMode?: 'closed' | 'invite' | 'open'; validInvites?: string[];`.
  - In `buildTestApp`, build them (default a Google-linked u1 so existing callback tests keep resolving to `u1`):

```ts
  const users = fakeUserRepo(opts.users ?? [{
    id: 'u1', email: 'a@example.com', passwordHash: null, isAdmin: false, googleId: 'g-1',
    googleRefreshToken: 'enc', autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0),
  } as User]);
  const invites = fakeInviteRepo({ valid: new Set(opts.validInvites ?? []) });
```
  - Add `users, invites` to `repos: { … }`.
  - Add `exchangeCodeForLink` to the fake `tokens`:
    ```ts
    exchangeCodeForLink: async () => ({ email: 'a@example.com', googleUserId: 'g-1', encryptedRefreshToken: 'enc' }),
    ```
  - Add to `config`: `registrationMode: opts.registrationMode ?? 'open'`.
  - Return `users, invites` from `buildTestApp` for use in tests.

- [ ] **Step 8: Run the whole server suite, expect PASS.**
```bash
cd packages/server && npm test
```
Expected: PASS (plumbing only; routes unchanged).

- [ ] **Step 9: Commit.**
```bash
git add packages/google/src/token-service.ts packages/google/test/token-service.test.ts packages/server/src/app.ts packages/server/src/server.ts packages/server/test/fakes.ts
git commit -m "feat(server): wire users/invites repos, registrationMode, exchangeCodeForLink

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `POST /auth/register`

**Files:**
- Modify: `packages/server/src/schemas.ts` (add `registerSchema`, `loginSchema`, `setPasswordSchema`, `changeEmailSchema`)
- Modify: `packages/server/src/auth-routes.ts`
- Test: `packages/server/test/auth.test.ts`

- [ ] **Step 1: Add schemas** to `packages/server/src/schemas.ts`:

```ts
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  inviteCode: z.string().min(1).optional(),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const setPasswordSchema = z.object({ password: z.string().min(10) });
export const changeEmailSchema = z.object({ email: z.string().email() });
```

- [ ] **Step 2: Write failing tests** — append to `packages/server/test/auth.test.ts`:

```ts
  it('register is rejected in closed mode', async () => {
    const { app } = buildTestApp({ registrationMode: 'closed', users: [] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'new@x.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(403);
  });

  it('register creates a user, default settings, and returns a token in open mode', async () => {
    const { app, users, settings } = buildTestApp({ registrationMode: 'open', users: [] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'New@X.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().token).toBe('string');
    const uid = res.json().userId;
    expect(await users.findByEmail('new@x.com')).toMatchObject({ id: uid }); // normalized
    expect(await settings.getByUserId(uid)).not.toBeNull();
  });

  it('register requires a valid invite in invite mode', async () => {
    const bad = buildTestApp({ registrationMode: 'invite', users: [], validInvites: [] });
    const r1 = await bad.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@x.com', password: 'longenough1', inviteCode: 'NOPE' } });
    expect(r1.statusCode).toBe(403);
    const good = buildTestApp({ registrationMode: 'invite', users: [], validInvites: ['GOOD'] });
    const r2 = await good.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'a@x.com', password: 'longenough1', inviteCode: 'GOOD' } });
    expect(r2.statusCode).toBe(200);
    expect(good.invites.consumed).toContain('GOOD');
  });

  it('register rejects a duplicate email', async () => {
    const { app } = buildTestApp({ registrationMode: 'open', users: [{ id: 'u9', email: 'dup@x.com', passwordHash: null, isAdmin: false, googleId: null, googleRefreshToken: null, autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'dup@x.com', password: 'longenough1' } });
    expect(res.statusCode).toBe(409);
  });
```

- [ ] **Step 3: Run, expect FAIL.**
```bash
cd packages/server && npm test -- auth
```
Expected: FAIL.

- [ ] **Step 4: Implement** — rewrite `packages/server/src/auth-routes.ts` adding the register route (full file shown; the Google routes are reworked in Task 11, so for now keep the existing Google handlers and add the new routes + imports):

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from './app.js';
import { authCallbackQuerySchema, registerSchema } from './schemas.js';
import { hashPassword } from './auth/password.js';
import { normalizeEmail } from './auth/email.js';
import { ensureUserDefaults } from './auth/user-defaults.js';
import { signSession } from './auth/token.js';

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/auth/google', async () => {
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri) };
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = signSession(app, user.id);
    if (deps.config.webClientUrl) {
      const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(user.id)}`;
      return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
    }
    return { token, userId: user.id };
  });

  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const mode = deps.config.registrationMode;

    if (mode === 'closed') {
      return reply.code(403).send({ code: 'registration_closed', message: 'Registration is closed' });
    }
    if (mode === 'invite') {
      const ok = body.inviteCode
        ? await deps.invites.validate(body.inviteCode, email, new Date(deps.now()))
        : false;
      if (!ok) return reply.code(403).send({ code: 'invalid_invite', message: 'A valid invite code is required' });
    }
    if (await deps.repos.users.findByEmail(email)) {
      return reply.code(409).send({ code: 'email_taken', message: 'That email is already registered' });
    }

    const passwordHash = await hashPassword(body.password);
    const user = await deps.repos.users.create({ email, passwordHash });
    await ensureUserDefaults(deps.repos.settings, user.id);
    if (mode === 'invite' && body.inviteCode) await deps.invites.consume(body.inviteCode);

    return { token: signSession(app, user.id), userId: user.id };
  });
}
```
(Note: `deps.now` is on `AppDeps`; if it is not surfaced in the route closure, read it via `deps.now()`. `AppDeps.now` exists — see `app.ts:46`.)

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/server && npm test -- auth
```
Expected: PASS (the existing Google-callback tests still pass — the callback is unchanged here aside from `signSession`, which still produces a verifiable `{ sub }` token).

- [ ] **Step 6: Commit.**
```bash
git add packages/server/src/schemas.ts packages/server/src/auth-routes.ts packages/server/test/auth.test.ts
git commit -m "feat(server): POST /auth/register with registration-mode gating

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: `POST /auth/login`

**Files:**
- Modify: `packages/server/src/auth-routes.ts`
- Test: `packages/server/test/auth.test.ts`

- [ ] **Step 1: Write failing tests** — append to `auth.test.ts`:

```ts
  it('login succeeds with correct credentials and fails generically otherwise', async () => {
    // Register first (open mode) so a passwordHash exists.
    const ctx = buildTestApp({ registrationMode: 'open', users: [] });
    await ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'log@x.com', password: 'longenough1' } });

    const ok = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'log@x.com', password: 'longenough1' } });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().token).toBe('string');

    const wrong = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'log@x.com', password: 'nope' } });
    expect(wrong.statusCode).toBe(401);
    const missing = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ghost@x.com', password: 'whatever' } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().message).toBe(wrong.json().message); // no user enumeration
  });
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/server && npm test -- auth
```
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `auth-routes.ts` (import `loginSchema`, `verifyPassword`):

```ts
  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const email = normalizeEmail(body.email);
    const invalid = () => reply.code(401).send({ code: 'invalid_credentials', message: 'Invalid email or password' });

    const user = await deps.repos.users.findByEmail(email);
    if (!user || !user.passwordHash) return invalid();
    if (!(await verifyPassword(user.passwordHash, body.password))) return invalid();
    return { token: signSession(app, user.id), userId: user.id };
  });
```

- [ ] **Step 4: Run, expect PASS.**
```bash
cd packages/server && npm test -- auth
```
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/server/src/auth-routes.ts packages/server/test/auth.test.ts
git commit -m "feat(server): POST /auth/login (argon2 verify, generic errors)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: `POST /auth/set-password` + `PATCH /auth/email` (authenticated)

**Files:**
- Modify: `packages/server/src/auth-routes.ts`
- Test: `packages/server/test/auth.test.ts`

- [ ] **Step 1: Write failing tests** — append to `auth.test.ts`:

```ts
  it('set-password lets a google-only user then log in with email+password', async () => {
    const ctx = buildTestApp({
      registrationMode: 'open',
      users: [{ id: 'u1', email: 'g@x.com', passwordHash: null, isAdmin: false, googleId: 'g-1', googleRefreshToken: 'enc', autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never],
    });
    const token = await tokenFor(ctx.app, 'u1');
    const set = await ctx.app.inject({ method: 'POST', url: '/auth/set-password', headers: { authorization: `Bearer ${token}` }, payload: { password: 'brandnewpw1' } });
    expect(set.statusCode).toBe(204);
    const login = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'g@x.com', password: 'brandnewpw1' } });
    expect(login.statusCode).toBe(200);
  });

  it('set-password requires auth', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/auth/set-password', payload: { password: 'longenough1' } });
    expect(res.statusCode).toBe(401);
  });

  it('change-email updates the account email', async () => {
    const ctx = buildTestApp({ users: [{ id: 'u1', email: 'old@x.com', passwordHash: null, isAdmin: false, googleId: null, googleRefreshToken: null, autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never] });
    const token = await tokenFor(ctx.app, 'u1');
    const res = await ctx.app.inject({ method: 'PATCH', url: '/auth/email', headers: { authorization: `Bearer ${token}` }, payload: { email: 'New@X.com' } });
    expect(res.statusCode).toBe(200);
    expect((await ctx.users.findById('u1'))?.email).toBe('new@x.com');
  });
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/server && npm test -- auth
```
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `auth-routes.ts` (import `setPasswordSchema`, `changeEmailSchema`; the guard pattern matches other route files):

```ts
  const guard = { onRequest: [app.authenticate] };

  app.post('/auth/set-password', guard, async (request, reply) => {
    const { password } = setPasswordSchema.parse(request.body);
    await deps.repos.users.update(request.userId, { passwordHash: await hashPassword(password) });
    return reply.code(204).send();
  });

  app.patch('/auth/email', guard, async (request) => {
    const { email } = changeEmailSchema.parse(request.body);
    const user = await deps.repos.users.update(request.userId, { email: normalizeEmail(email) });
    return { id: user.id, email: user.email };
  });
```
(Duplicate-email collisions surface as the repo's `ConflictError` → mapped to 409 by the global error handler.)

- [ ] **Step 4: Run, expect PASS.**
```bash
cd packages/server && npm test -- auth
```
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/server/src/auth-routes.ts packages/server/test/auth.test.ts
git commit -m "feat(server): set-password + change-email (authenticated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Decouple & gate the Google callback (login / link-by-email / gated-create) + state

**Files:**
- Modify: `packages/google/src/client.ts` (already supports `getConsentUrl(redirectUri, state?)` — no change) and `packages/server/src/schemas.ts` (callback query gains optional `state`, `error`)
- Modify: `packages/server/src/auth-routes.ts` (rework callback, add `/auth/google/link`, accept `?invite=`)
- Test: `packages/server/test/auth.test.ts`

- [ ] **Step 1: Extend the callback query schema** in `schemas.ts`:

```ts
export const authCallbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().optional() });
export const consentQuerySchema = z.object({ invite: z.string().min(1).optional() });
```

- [ ] **Step 2: Write failing tests** — replace the existing "callback exchanges a code for a JWT" test and add branches:

```ts
  it('callback logs in an existing google user (branch 1)', async () => {
    const { app } = buildTestApp(); // default seed: u1 with googleId g-1
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe('u1');
  });

  it('callback links by email to an existing password account (branch 2)', async () => {
    const ctx = buildTestApp({
      registrationMode: 'closed',
      users: [{ id: 'u5', email: 'a@example.com', passwordHash: 'h', isAdmin: false, googleId: null, googleRefreshToken: null, autoScheduledCalendarId: null, createdAt: new Date(0), updatedAt: new Date(0) } as never],
    });
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe('u5');
    expect((await ctx.users.findById('u5'))?.googleId).toBe('g-1'); // linked
  });

  it('callback rejects a brand-new google email when registration is closed (branch 3)', async () => {
    const ctx = buildTestApp({ registrationMode: 'closed', users: [] });
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(403);
  });

  it('callback creates a new account from google in open mode (branch 3)', async () => {
    const ctx = buildTestApp({ registrationMode: 'open', users: [] });
    const res = await ctx.app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(200);
    expect(await ctx.users.findByEmail('a@example.com')).not.toBeNull();
    expect(await ctx.settings.getByUserId(res.json().userId)).not.toBeNull();
  });

  it('/auth/google/link requires auth and embeds a state', async () => {
    const ctx = buildTestApp();
    const unauth = await ctx.app.inject({ method: 'GET', url: '/auth/google/link' });
    expect(unauth.statusCode).toBe(401);
    const token = await tokenFor(ctx.app, 'u1');
    const ok = await ctx.app.inject({ method: 'GET', url: '/auth/google/link', headers: { authorization: `Bearer ${token}` } });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().url).toBe('string');
  });
```
Also update the existing redirect test's expectations remain valid (`userId=u1`).

- [ ] **Step 3: Run, expect FAIL.**
```bash
cd packages/server && npm test -- auth
```
Expected: FAIL.

- [ ] **Step 4: Implement the reworked callback** in `auth-routes.ts`. Replace the two Google handlers with:

```ts
  // State is a short-lived signed JWT so we can trust its purpose/userId/inviteCode on return.
  const signState = (data: Record<string, unknown>) => app.jwt.sign({ st: data }, { expiresIn: '10m' });
  const readState = (raw?: string): { purpose?: string; userId?: string; inviteCode?: string } => {
    if (!raw) return {};
    try { return (app.jwt.verify<{ st: Record<string, unknown> }>(raw).st ?? {}) as never; }
    catch { return {}; }
  };

  app.get('/auth/google', async (request) => {
    const { invite } = consentQuerySchema.parse(request.query);
    const state = signState({ purpose: 'login', ...(invite ? { inviteCode: invite } : {}) });
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri, state) };
  });

  app.get('/auth/google/link', { onRequest: [app.authenticate] }, async (request) => {
    const state = signState({ purpose: 'link', userId: request.userId });
    return { url: deps.google.client.getConsentUrl(deps.config.googleRedirectUri, state) };
  });

  app.get('/auth/google/callback', async (request, reply) => {
    const { code, state: rawState } = authCallbackQuerySchema.parse(request.query);
    const state = readState(rawState);
    const { email, googleUserId, encryptedRefreshToken } =
      await deps.google.tokens.exchangeCodeForLink(code, deps.config.googleRedirectUri);
    const link = (userId: string) =>
      deps.repos.users.update(userId, { googleId: googleUserId, googleRefreshToken: encryptedRefreshToken });

    const finish = (userId: string) => {
      const token = signSession(app, userId);
      if (deps.config.webClientUrl) {
        const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(userId)}`;
        return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
      }
      return reply.send({ token, userId });
    };
    const deny = (codeStr: string) => {
      if (deps.config.webClientUrl) {
        return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#error=${encodeURIComponent(codeStr)}`);
      }
      return reply.code(403).send({ code: codeStr, message: 'Registration is closed' });
    };

    // Authenticated linking flow.
    if (state.purpose === 'link' && state.userId) {
      await link(state.userId);
      return finish(state.userId);
    }
    // Branch 1: known google account.
    const byGoogle = await deps.repos.users.findByGoogleId(googleUserId);
    if (byGoogle) { await link(byGoogle.id); return finish(byGoogle.id); }
    // Branch 2: known email → link.
    const byEmail = await deps.repos.users.findByEmail(email);
    if (byEmail) { await link(byEmail.id); return finish(byEmail.id); }
    // Branch 3: new email → gated registration.
    const mode = deps.config.registrationMode;
    if (mode === 'closed') return deny('registration_closed');
    if (mode === 'invite') {
      const ok = state.inviteCode
        ? await deps.invites.validate(state.inviteCode, email, new Date(deps.now()))
        : false;
      if (!ok) return deny('invalid_invite');
    }
    const created = await deps.repos.users.create({ email });
    await link(created.id);
    await ensureUserDefaults(deps.repos.settings, created.id);
    if (mode === 'invite' && state.inviteCode) await deps.invites.consume(state.inviteCode);
    return finish(created.id);
  });
```
Add `consentQuerySchema` to the import from `./schemas.js`. Remove the now-unused `connectFromCode` usage (you may leave the method in the token service / its Pick for backward compat, or drop `'connectFromCode'` from the Pick and the fake — keep it to minimize churn).

- [ ] **Step 5: Run, expect PASS.**
```bash
cd packages/server && npm test -- auth
```
Expected: PASS (all branches + the redirect test).

- [ ] **Step 6: Commit.**
```bash
git add packages/server/src/auth-routes.ts packages/server/src/schemas.ts packages/server/test/auth.test.ts
git commit -m "feat(server): gated Google callback (login/link-by-email/gated-create) + signed state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: Data-isolation hardening (repo update reads)

**Files:**
- Modify: `packages/db/src/repositories/task-repository.ts:76`, `habit-repository.ts` (~47), `calendar-event-repository.ts` (~32, `setGoogleIds`), `scheduled-block-repository.ts` (~67), `category-repository.ts` (~63)
- Test: `packages/db/test/repositories/task-repository.test.ts` (+ mirror in the others if quick)

- [ ] **Step 1: Write a failing isolation test** — append to `task-repository.test.ts` (it already uses the real test DB and two users):

```ts
  it('update cannot touch another user\'s task and returns the caller\'s row', async () => {
    const { createUserRepository } = await import('../../src/repositories/user-repository.js');
    const users = createUserRepository(prisma);
    const a = await users.create({ email: `a-${Math.random()}@x.com` });
    const b = await users.create({ email: `b-${Math.random()}@x.com` });
    const repo = (await import('../../src/repositories/task-repository.js')).createTaskRepository(prisma);
    const t = await repo.create(a.id, { title: 'A task', priority: 1, durationMs: 3_600_000, dueBy: new Date('2026-01-02T17:00:00Z'), minChunkMs: 900_000, maxChunkMs: 1_800_000 });
    const { NotFoundError } = await import('../../src/errors.js');
    await expect(repo.update(b.id, t.id, { title: 'hijack' })).rejects.toBeInstanceOf(NotFoundError);
    const still = await repo.findById(a.id, t.id);
    expect(still?.title).toBe('A task');
  });
```

- [ ] **Step 2: Run, expect FAIL** (today `update` re-reads by `id` only, so it would not throw for user B until the `updateMany` count is 0 — actually `updateMany({where:{id,userId}})` already returns count 0 for the wrong user, so this specific test may PASS already; the real fix is the *return read*). Reframe: the bug is the **return** of `findUniqueOrThrow({where:{id}})`. Add this assertion that pins the fix:

```ts
  it('a successful update returns the row scoped to the owner', async () => {
    const users = (await import('../../src/repositories/user-repository.js')).createUserRepository(prisma);
    const a = await users.create({ email: `o-${Math.random()}@x.com` });
    const repo = (await import('../../src/repositories/task-repository.js')).createTaskRepository(prisma);
    const t = await repo.create(a.id, { title: 'Owned', priority: 1, durationMs: 3_600_000, dueBy: new Date('2026-01-02T17:00:00Z'), minChunkMs: 900_000, maxChunkMs: 1_800_000 });
    const updated = await repo.update(a.id, t.id, { title: 'Owned 2' });
    expect(updated.userId).toBe(a.id);
    expect(updated.title).toBe('Owned 2');
  });
```

- [ ] **Step 3: Apply the fix** to each of the five repos — replace `findUniqueOrThrow({ where: { id } })` with `findFirstOrThrow({ where: { id, userId } })`. For example in `task-repository.ts:76`:

```ts
        return await prisma.task.findFirstOrThrow({ where: { id, userId } });
```
Apply the analogous change in `habit-repository.ts`, `scheduled-block-repository.ts`, `category-repository.ts`, and `calendar-event-repository.ts` (`setGoogleIds`, which has `userId` in scope).

- [ ] **Step 4: Run, expect PASS.**
```bash
cd packages/db && npm test
```
Expected: PASS (full db suite).

- [ ] **Step 5: Commit.**
```bash
git add packages/db/src/repositories/task-repository.ts packages/db/src/repositories/habit-repository.ts packages/db/src/repositories/calendar-event-repository.ts packages/db/src/repositories/scheduled-block-repository.ts packages/db/src/repositories/category-repository.ts packages/db/test/repositories/task-repository.test.ts
git commit -m "fix(db): scope post-update reads by userId (data isolation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 13: Admin CLI

**Files:**
- Create: `packages/server/scripts/admin.mjs`
- Modify: `packages/server/package.json` (a convenience `"admin"` script)
- Test: manual (CLI against the dev DB)

- [ ] **Step 1: Implement** `packages/server/scripts/admin.mjs`:

```js
#!/usr/bin/env node
import crypto from 'node:crypto';
import { prisma, createUserRepository, createInviteCodeRepository, createSettingsRepository } from '@notreclaim/db';
import { hashPassword } from '../dist/auth/password.js';
import { ensureUserDefaults } from '../dist/auth/user-defaults.js';

const users = createUserRepository(prisma);
const invites = createInviteCodeRepository(prisma);
const settings = createSettingsRepository(prisma);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);
const norm = (e) => e.trim().toLowerCase();

const cmd = process.argv[2];
try {
  if (cmd === 'create-user') {
    const email = norm(arg('email'));
    const password = arg('password');
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await users.create({ email, passwordHash, isAdmin: has('admin') });
    await ensureUserDefaults(settings, user.id);
    console.log(`created user ${user.id} <${email}>${has('admin') ? ' (admin)' : ''}${password ? '' : ' (google-only)'}`);
  } else if (cmd === 'set-password') {
    const user = await users.findByEmail(norm(arg('email')));
    if (!user) throw new Error('no such user');
    await users.update(user.id, { passwordHash: await hashPassword(arg('password')) });
    console.log(`password updated for ${user.email}`);
  } else if (cmd === 'create-invite') {
    const admin = await users.findByEmail(norm(arg('by') ?? arg('email') ?? '')) ?? (await firstAdmin());
    const code = crypto.randomBytes(9).toString('base64url');
    await invites.create({
      code,
      createdByUserId: admin.id,
      email: arg('email') ? norm(arg('email')) : null,
      maxUses: arg('max-uses') ? Number(arg('max-uses')) : 1,
      expiresAt: arg('expires') ? new Date(arg('expires')) : null,
    });
    console.log(`invite code: ${code}`);
  } else {
    console.log('usage: admin <create-user|set-password|create-invite> [--email] [--password] [--admin] [--max-uses] [--expires]');
  }
} finally {
  await prisma.$disconnect();
}

async function firstAdmin() {
  const a = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (!a) throw new Error('no admin user exists; run create-user --admin first');
  return a;
}
```
(The script imports from `dist/` so the server must be built first: `cd packages/server && npm run build`.)

- [ ] **Step 2: Add a convenience script** to `packages/server/package.json` `scripts`:
```json
"admin": "node scripts/admin.mjs"
```

- [ ] **Step 3: Verify manually** against the dev DB (build first):
```bash
cd packages/server && npm run build && JWT_SECRET=dev DATABASE_URL="$DEV_DATABASE_URL" node scripts/admin.mjs create-user --email me@example.com --admin
```
Expected: prints `created user <uuid> <me@example.com> (admin) (google-only)`. Confirm a Settings row exists for that user.

- [ ] **Step 4: Commit.**
```bash
git add packages/server/scripts/admin.mjs packages/server/package.json
git commit -m "feat(server): admin CLI (create-user/set-password/create-invite)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 14: Web API client methods

**Files:**
- Modify: `packages/web/src/api/client.ts` (interface + impl)
- Test: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Write failing tests** — append to `client.test.ts` (match its existing fetch-mock style; if it stubs `global.fetch`, follow that pattern):

```ts
  it('register POSTs credentials and returns the token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 't', userId: 'u' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => null });
    const out = await api.register({ email: 'a@x.com', password: 'longenough1' });
    expect(out).toEqual({ token: 't', userId: 'u' });
    expect(fetchMock).toHaveBeenCalledWith('/auth/register', expect.objectContaining({ method: 'POST' }));
  });
```
(Use the file's existing helpers if present rather than re-stubbing.)

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/web && TZ=UTC npm test -- client
```
Expected: FAIL.

- [ ] **Step 3: Implement** — add to the `ApiClient` interface and the returned object in `client.ts`:

```ts
  // interface ApiClient { … add: }
  register(body: { email: string; password: string; inviteCode?: string }): Promise<{ token: string; userId: string }>;
  login(body: { email: string; password: string }): Promise<{ token: string; userId: string }>;
  setPassword(password: string): Promise<void>;
  changeEmail(email: string): Promise<{ id: string; email: string }>;
  getLinkGoogleUrl(): Promise<{ url: string }>;
```
```ts
  // returned object { … add: }
  register: (body) => request('POST', '/auth/register', body),
  login: (body) => request('POST', '/auth/login', body),
  setPassword: (password) => request('POST', '/auth/set-password', { password }),
  changeEmail: (email) => request('PATCH', '/auth/email', { email }),
  getLinkGoogleUrl: () => request('GET', '/auth/google/link'),
```
Also add the five methods to `packages/web/src/test/fakes.tsx`'s `base` object as `notImplemented('…')` entries so the fake stays type-complete.

- [ ] **Step 4: Run, expect PASS.**
```bash
cd packages/web && TZ=UTC npm test -- client
```
Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/web/src/api/client.ts packages/web/src/api/client.test.ts packages/web/src/test/fakes.tsx
git commit -m "feat(web): api client register/login/set-password/change-email/link-google

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 15: SignIn (password) + Register page

**Files:**
- Modify: `packages/web/src/auth/SignIn.tsx`
- Create: `packages/web/src/auth/Register.tsx`
- Modify: `packages/web/src/app/App.tsx:16-18` (add `/register` route)
- Modify: `packages/web/src/auth/AuthCallback.tsx` (handle `#error=`)
- Test: `packages/web/src/auth/SignIn.test.tsx`, `packages/web/src/auth/Register.test.tsx`

- [ ] **Step 1: Write failing tests** — `SignIn.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { SignIn } from './SignIn';

describe('SignIn', () => {
  it('logs in with email + password and stores the token', async () => {
    const login = vi.fn(async () => ({ token: 't', userId: 'u' }));
    renderWithProviders(<SignIn />, { api: fakeApiClient({ login }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in$/i }));
    await waitFor(() => expect(login).toHaveBeenCalledWith({ email: 'a@x.com', password: 'longenough1' }));
    expect(JSON.parse(localStorage.getItem('notreclaim.auth')!)).toMatchObject({ token: 't', userId: 'u' });
  });

  it('shows an error on bad credentials', async () => {
    const login = vi.fn(async () => { const { ApiError } = await import('../api/client'); throw new ApiError(401, 'invalid_credentials', 'Invalid email or password'); });
    renderWithProviders(<SignIn />, { api: fakeApiClient({ login }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in$/i }));
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
  });
});
```
`Register.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../test/fakes';
import { Register } from './Register';

describe('Register', () => {
  it('registers and stores the token', async () => {
    const register = vi.fn(async () => ({ token: 't', userId: 'u' }));
    renderWithProviders(<Register />, { api: fakeApiClient({ register }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(localStorage.getItem('notreclaim.auth')).toContain('"token":"t"');
  });

  it('surfaces a closed-registration message', async () => {
    const register = vi.fn(async () => { const { ApiError } = await import('../api/client'); throw new ApiError(403, 'registration_closed', 'Registration is closed'); });
    renderWithProviders(<Register />, { api: fakeApiClient({ register }) });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@x.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/registration is closed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/web && TZ=UTC npm test -- SignIn Register
```
Expected: FAIL.

- [ ] **Step 3: Implement** `SignIn.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';

export function SignIn() {
  const api = useApi();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { token, userId } = await api.login({ email, password });
      setAuth({ token, userId });
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    const { url } = await api.getConsentUrl();
    window.location.assign(url);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">NotReclaim</h1>
      <p className="text-gray-500">Your calendar, auto-scheduled.</p>
      <form onSubmit={onPasswordSignIn} className="flex w-72 flex-col gap-2">
        <label className="text-sm" htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-3 py-2" required />
        <label className="text-sm" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Sign in</button>
      </form>
      <button onClick={onGoogle} className="rounded border px-4 py-2">Sign in with Google</button>
      <p className="text-sm text-gray-500">No account? <Link to="/register" className="text-blue-600">Create one</Link></p>
    </div>
  );
}
```

- [ ] **Step 4: Implement** `Register.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';

export function Register() {
  const api = useApi();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { token, userId } = await api.register({ email, password, inviteCode: inviteCode || undefined });
      setAuth({ token, userId });
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex w-72 flex-col gap-2">
        <label className="text-sm" htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-3 py-2" required />
        <label className="text-sm" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" minLength={10} required />
        <label className="text-sm" htmlFor="invite">Invite code (if required)</label>
        <input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="rounded border px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Create account</button>
      </form>
      <p className="text-sm text-gray-500">Have an account? <Link to="/signin" className="text-blue-600">Sign in</Link></p>
    </div>
  );
}
```

- [ ] **Step 5: Add the route** in `App.tsx` (after the `/signin` route):
```tsx
      <Route path="/register" element={<Register />} />
```
(import `Register` from `../auth/Register`.)

- [ ] **Step 6: Handle `#error=` in `AuthCallback.tsx`** — before reading token, check for an error param and route to signin with a message (store it in state or a query param):
```tsx
    const err = params.get('error');
    if (err) { navigate(`/signin?error=${encodeURIComponent(err)}`, { replace: true }); return; }
```

- [ ] **Step 7: Run, expect PASS.**
```bash
cd packages/web && TZ=UTC npm test -- SignIn Register
```
Expected: PASS.

- [ ] **Step 8: Commit.**
```bash
git add packages/web/src/auth/SignIn.tsx packages/web/src/auth/Register.tsx packages/web/src/auth/AuthCallback.tsx packages/web/src/app/App.tsx packages/web/src/auth/SignIn.test.tsx packages/web/src/auth/Register.test.tsx
git commit -m "feat(web): email+password SignIn and gated Register page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 16: Account section in Settings + identity/Logout

**Files:**
- Create: `packages/web/src/app/settings/AccountSection.tsx`
- Modify: `packages/web/src/app/pages/Settings.tsx` (render the section)
- Modify: a shell file for identity + Logout — `packages/web/src/app/shell/Sidebar.tsx` (or wherever the nav lives; place a Logout button that calls `useAuth().signOut()` then routes to `/signin`)
- Test: `packages/web/src/app/settings/AccountSection.test.tsx`

- [ ] **Step 1: Write failing test** — `AccountSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { AccountSection } from './AccountSection';

describe('AccountSection', () => {
  it('sets a password', async () => {
    const setPassword = vi.fn(async () => undefined);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ setPassword }) });
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'longenough1' } });
    fireEvent.click(screen.getByRole('button', { name: /save password/i }));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith('longenough1'));
  });

  it('starts the Connect Google flow', async () => {
    const getLinkGoogleUrl = vi.fn(async () => ({ url: 'https://consent.example/x' }));
    const assign = vi.fn();
    vi.stubGlobal('location', { assign } as unknown as Location);
    renderWithProviders(<AccountSection />, { api: fakeApiClient({ getLinkGoogleUrl }) });
    fireEvent.click(screen.getByRole('button', { name: /connect google/i }));
    await waitFor(() => expect(getLinkGoogleUrl).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**
```bash
cd packages/web && TZ=UTC npm test -- AccountSection
```
Expected: FAIL.

- [ ] **Step 3: Implement** `AccountSection.tsx`:

```tsx
import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { ApiError } from '../../api/client';

export function AccountSection() {
  const api = useApi();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null); setErr(null);
    try { await api.setPassword(password); setPassword(''); setMsg('Password saved'); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Failed'); }
  };
  const connectGoogle = async () => {
    const { url } = await api.getLinkGoogleUrl();
    window.location.assign(url);
  };

  return (
    <section className="mt-8 rounded-[14px] border border-line p-4">
      <h2 className="mb-3 text-lg font-semibold">Account</h2>
      <form onSubmit={savePassword} className="flex max-w-sm flex-col gap-2">
        <label className="text-sm" htmlFor="newpw">New password</label>
        <input id="newpw" type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" required />
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">Save password</button>
      </form>
      <button onClick={connectGoogle} className="mt-4 rounded border px-4 py-2">Connect Google (calendar sync)</button>
    </section>
  );
}
```

- [ ] **Step 4: Render it** in `Settings.tsx` — inside the `max-w-[720px]` wrapper, after `<SettingsForm … />` add `<AccountSection />` (import it).

- [ ] **Step 5: Add a Logout control.** Find the shell/nav component that renders on every authed page (search `useAuth` usage / `AppShell`). Add a button:
```tsx
const { signOut } = useAuth();
// …
<button onClick={() => { signOut(); window.location.assign('/signin'); }} className="…">Log out</button>
```
If the current user's email is needed for display and isn't in `AuthContext`, show `userId` for now or add a `GET /auth/me` in a follow-up (out of scope here — note it).

- [ ] **Step 6: Run, expect PASS** (account test + full web suite).
```bash
cd packages/web && TZ=UTC npm test
```
Expected: PASS.

- [ ] **Step 7: Commit.**
```bash
git add packages/web/src/app/settings/AccountSection.tsx packages/web/src/app/pages/Settings.tsx packages/web/src/app/settings/AccountSection.test.tsx packages/web/src/app/shell/Sidebar.tsx
git commit -m "feat(web): Account settings (set password, connect Google) + Logout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Final verification

- [ ] Run every package suite (server/db need the test DB up; web needs `TZ=UTC`):
```bash
cd packages/db && npm test && cd ../server && npm test && cd ../google && npm test && cd ../web && TZ=UTC npm test
```
Expected: all green. Then dispatch a final code review (superpowers:requesting-code-review) before merging the branch.

---

## Self-Review

**Spec coverage** (against `2026-06-18-multi-user-auth-and-deployment-design.md`, Phase 1):
- passwordHash + isAdmin + InviteCode → Task 1 ✓; REGISTRATION_MODE + JWT TTL → Task 6 ✓; argon2 password module → Task 4 ✓; user repo extensions → Task 2 ✓; invite repo → Task 3 ✓; ensureUserDefaults + defensive read → Task 5 (service) ✓ — **note:** the spec also wanted a defensive create-if-missing inside the settings read path; I kept `GET /settings` returning 404 as-is and instead guarantee defaults at account-creation time (register, Google-create, admin CLI). This is sufficient because every account-creation path calls `ensureUserDefaults`; a defensive `GET /settings` fallback is optional hardening and is called out here rather than silently dropped.
- register/login → Tasks 8–9 ✓; set-password/change-email → Task 10 ✓; Google decoupling/link/gate + state → Task 11 ✓; isolation hardening → Task 12 ✓; admin CLI → Task 13 ✓; frontend client/signin/register/account/logout → Tasks 14–16 ✓.

**Placeholder scan:** No TBD/TODO. Two explicitly-scoped deferrals are labelled, not hidden: (a) the `GET /auth/me` for showing the signed-in email (Task 16 shows `userId` and flags `/auth/me` as a small follow-up); (b) keeping `connectFromCode` in the token service for backward-compat rather than deleting it (Task 11) — harmless, avoids churn.

**Type/signature consistency:** `ensureUserDefaults(settingsRepo, userId, timezone?)` is called identically in Tasks 8, 11, 13. `signSession(app, userId)` used in 8/9/11. `exchangeCodeForLink` returns `{ email, googleUserId, encryptedRefreshToken }` in the token service (Task 7), the fake (Task 7), and the callback consumer (Task 11) — consistent. `repos.users` Pick (`findById|findByEmail|findByGoogleId|create|update`) covers every call made in Tasks 8–11. `repos.invites` Pick (`validate|consume`) matches Tasks 8/11 usage and the real repo (Task 3). Web client method names (`register|login|setPassword|changeEmail|getLinkGoogleUrl`) are consistent across Tasks 14–16 and the fakes.

**Open questions / assumptions (flagged for the implementer):**
1. **argon2 package/version**: assumed `@node-rs/argon2@^2` (prebuilt, glibc) — confirm it installs on the dev box and the Plan-B base image; if a musl/alpine base is chosen in Plan B, use the matching `@node-rs/argon2-linux-*-musl` optional dep or a glibc base.
2. **Lockfile location**: repo uses npm workspaces — the lockfile may be at the repo root; adjust the `git add` in Task 4 accordingly.
3. **`client.test.ts` mock style**: I assumed a `vi.stubGlobal('fetch', …)` pattern; match whatever that file already does.
4. **Shell/nav file for Logout**: I referenced `packages/web/src/app/shell/Sidebar.tsx` by convention — confirm the actual component that renders on every authed page (could be `AppShell.tsx`).
5. **`GET /settings` 404 vs defaults**: confirmed approach above; if you prefer the planner to never 404, add a create-if-missing in `settings-routes.ts` GET as optional hardening.
