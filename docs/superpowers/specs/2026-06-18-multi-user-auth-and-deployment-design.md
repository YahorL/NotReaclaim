# Multi-User Auth & Proxmox Deployment — Design

**Date:** 2026-06-18
**Status:** Approved decisions captured; pending user review of this spec.

## Goal

Turn NotReclaim from "runs for the demo user on localhost" into a self-hosted multi-user
app where people sign in with **email + password** (primary) or **Google** (secondary,
linkable), where **registration is gated** (closed now, openable later), and which is
**deployed as a container stack on a Proxmox box** reached over **Tailscale** with
automatic HTTPS.

## Context: what already exists (do not rebuild)

The codebase is already architecturally multi-user. Confirmed by exploration:

- **`User` model** (`packages/db/prisma/schema.prisma:28-44`): `id` (UUID PK), `email`
  (unique), `googleId` (unique, nullable), `googleRefreshToken` (nullable, encrypted),
  `autoScheduledCalendarId`, timestamps.
- **Every** data model is scoped by `userId` with `onDelete: Cascade`: `Settings`
  (`userId @unique`), `Task`, `Subtask` (via task), `Category`, `Habit`,
  `ScheduledBlock`, `CalendarEvent`, `CalendarSyncState`.
- **JWT auth** (`packages/server/src/app.ts:54-80`): `@fastify/jwt`, secret from
  `config.jwtSecret`; an `authenticate` decorator verifies the token and sets
  `request.userId = payload.sub`. All route files apply `{ onRequest: [app.authenticate] }`.
- **Google OAuth login** (`packages/server/src/auth-routes.ts:5-21`): `/auth/google`
  returns a consent URL; `/auth/google/callback` exchanges the code via
  `google.tokens.connectFromCode()` (creates/updates user by `googleId`, stores encrypted
  refresh token) and signs `{ sub: user.id }`.
- **Per-user Google tokens** (`packages/google/src/token-service.ts`): in-memory cache keyed
  by `userId`; refresh token decrypted per user.
- **Frontend auth already present**: `packages/web/src/auth/SignIn.tsx` (Google button),
  `AuthCallback.tsx` (reads `token`/`userId` from URL hash → `tokenStore`),
  `ProtectedRoute.tsx` (redirects to `/signin` when no token),
  `auth/tokenStore.ts` (localStorage key `notreclaim.auth`),
  `api/client.ts:53-81` (attaches `Authorization: Bearer <token>`), 401 → clear token →
  `/signin` (`main.tsx`).
- **Web → API base** via `VITE_API_URL` (`main.tsx`), Vite dev proxy in `vite.config.ts`.

**Implication:** This project is mostly *additive* (a second auth method, a registration
gate, deployment) plus small hardening — not a re-architecture.

## Decisions (locked with user)

1. **Identity is local, not Google.** Primary identity = the existing `User.id` UUID +
   email; `passwordHash` is nullable. Google is a linked provider that also grants calendar
   sync, but it does **not** define the account. A user with no Google link still uses the
   planner; only calendar sync is unavailable.
2. **Two full auth methods, both built now.** Google OAuth and email+password are each a
   complete register+login path. A logged-in user can also **add the other credential** to
   their existing account — a Google-registered user sets a password (and can edit their
   email); a password user connects Google. Because the account is anchored to the UUID,
   adding a password later needs no migration.
3. **Registration gate:** `REGISTRATION_MODE = closed | invite | open` (default `closed`),
   applied to **both** Google new-account creation and email+password registration. Owner
   bootstrap is via the **admin CLI** (`create-user`, by email, password optional); the
   first "Sign in with Google" then **links by email** to that pre-created account.
4. **Email flows deferred for v1:** no SMTP. Password resets via admin CLI. Add
   self-service verification/reset later (before opening to the public).
5. **Deploy:** Docker Compose on a Proxmox VM/LXC, exposed via **Tailscale Serve**
   (auto-HTTPS on `*.ts.net`, no port-forwarding).

## Architecture

### Phase 1 — Auth & multi-user app changes

#### Data model (`packages/db/prisma/schema.prisma`)

Add to `User`:
- `passwordHash String?` — argon2id hash; null for users who only ever used Google.
- `isAdmin Boolean @default(false)` — gate for invite management / admin actions.

New model:
```prisma
model InviteCode {
  id              String    @id @default(uuid())
  code            String    @unique          // random, high-entropy
  email           String?                    // optional: bind to a specific email
  maxUses         Int       @default(1)
  usedCount       Int       @default(0)
  expiresAt       DateTime?
  createdByUserId String
  createdAt       DateTime  @default(now())
}
```
A migration is generated with `prisma migrate dev` and applied in prod via
`prisma migrate deploy`.

#### Config (`packages/server/src/config.ts`)

Add:
- `REGISTRATION_MODE` (`closed` | `invite` | `open`, default `closed`).

Keep existing: `JWT_SECRET`, `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID/SECRET`,
`GOOGLE_REDIRECT_URI`, `WEB_CLIENT_URL`, `DATABASE_URL`, `PORT`, `POLL_INTERVAL_MS`.

Add a JWT **expiry** (e.g. `expiresIn: '30d'`) wherever `app.jwt.sign` is called, so
tokens are not indefinite.

#### Password hashing

- Library: **argon2id** (a maintained Node lib; prefer a prebuilt-binary package to avoid
  native build pain in the container — e.g. `@node-rs/argon2`). Decision finalized in plan.
- Helpers in a small module (`packages/server/src/auth/password.ts`): `hashPassword`,
  `verifyPassword`. Never log raw passwords.

#### Auth endpoints (`packages/server/src/auth-routes.ts` + new modules)

- `POST /auth/register` — body `{ email, password, inviteCode? }`:
  - `closed`: respond `403` ("registration closed"). Accounts only via admin CLI.
  - `invite`: require a valid, unexpired, non-exhausted `inviteCode` (and matching `email`
    if the code is email-bound); on success consume it (`usedCount++`).
  - `open`: create freely.
  - Validate email format + uniqueness (case-insensitive); password length ≥ 10.
  - Create user with `passwordHash`; **create default Settings** (see below); sign and
    return `{ token, userId }`.
- `POST /auth/login` — body `{ email, password }`:
  - Look up by email; `verifyPassword`. On failure return a **generic** `401`
    ("invalid email or password") to avoid user enumeration. On success return
    `{ token, userId }`.
- **Google flow, decoupled** (`/auth/google`, `/auth/google/callback`):
  - Initiate carries a signed `state`. If the request is **authenticated** (a logged-in
    user clicking "Connect Google"), `state` encodes their `userId` → callback **links**
    `googleId` + refresh token to that existing account (no new user).
  - If **not** authenticated, the callback resolves identity by:
    1. existing user with this `googleId` → **login**;
    2. else existing user with this **email** (from Google profile) → **link + login**;
    3. else **new email** → registration via Google, **gated**: `open` creates the account
       + default Settings; `invite` creates it only if a valid invite code was carried
       through the OAuth `state` (collected on the sign-in/register page before redirect);
       `closed` rejects with a friendly message. (Owner bootstrap in `closed` mode does not
       hit this branch — the admin CLI pre-creates the owner account, so the owner's Google
       sign-in resolves via branch 2 = link-by-email.)
  - Requires fetching the Google account **email** (from `id_token`/userinfo). Extend the
    google token service so `connectFromCode` returns the email, or add a userinfo lookup.

#### Add / link credentials to an existing account (authenticated)

So a Google-registered user can later log in with email+password (and vice-versa):
- `POST /auth/set-password` (authenticated) — body `{ password }`: sets/replaces
  `passwordHash` on the caller's account. Enables email+password login for a Google user.
- `PATCH /auth/email` (authenticated) — body `{ email }`: change the account email
  (validated, unique). Optional but cheap; lets a Google user pick a different login email.
- "Connect Google" for a password user reuses the `/auth/google` flow with an authenticated
  `state` (the link branch above).

#### First-run defaults

A single service `ensureUserDefaults(userId, timezone?)` creates a `Settings` row if absent:
Mon–Fri 09:00–17:00, `horizonDays: 14`, default chunk/buffer values matching current demo
defaults. Called right after any user creation (register, admin CLI, open-mode Google).
Also add a defensive create-if-missing in the settings read path
(`packages/db/src/repositories/settings-repository.ts` getByUserId) so no account can land
on a broken planner.

#### Data-isolation hardening

In these repos, the post-`updateMany` read currently does
`findUniqueOrThrow({ where: { id } })` (no `userId`). Change to
`findFirstOrThrow({ where: { id, userId } })`:
- `task-repository.ts:76`, `habit-repository.ts:47`,
  `calendar-event-repository.ts:32`, `scheduled-block-repository.ts:67`,
  `category-repository.ts:63`.
Add tests proving user A cannot read/update user B's row by id.

#### Admin CLI (`packages/server/scripts/admin.mjs` or a `bin` command)

Reuses repos + password helpers. Commands:
- `create-user --email <e> [--password <p>] [--admin]` — bootstrap yourself in `closed`
  mode; creates default Settings. **Password optional**: omit it to create a Google-only
  account (you then "Sign in with Google" and it links by email); add `--password` if you
  want email+password from the start.
- `set-password --email <e> --password <p>` — password reset (email reset deferred).
- `create-invite [--email <e>] [--max-uses <n>] [--expires <iso>]` — print a new code.
This replaces the dev-only `seed-dev.mjs` for production account creation.

#### Frontend (`packages/web`)

- `api/client.ts`: add `register({email,password,inviteCode?})`, `login({email,password})`,
  and a `connectGoogle()` (authenticated consent start).
- `SignIn.tsx`: add email + password fields and a "Sign in" submit (calls `login`,
  stores `{token,userId}` like the Google callback). Keep "Sign in with Google". Add a
  link to **Register**.
- New `Register.tsx` (+ route): email, password, confirm, optional invite-code field.
  Calls `register`. Surfaces server messages (e.g. "registration is closed", "invalid
  invite code"). On success store token and route into the app.
- **Account section in Settings:**
  - **Connect Google** for password users (enables calendar sync).
  - **Add / change password** (calls `POST /auth/set-password`) so a Google-registered user
    can enable email+password login. Show whether a password is already set.
  - **Change email** (calls `PATCH /auth/email`), optional.
- **Identity + Logout**: show the signed-in email and a Logout control (sidebar/topbar);
  Logout clears `tokenStore` and routes to `/signin`.

### Phase 2 — Containerized deployment (Proxmox + Tailscale)

#### Topology

One origin behind **Caddy**:
- Caddy serves the built web SPA (static `dist/`).
- Caddy reverse-proxies API paths (`/auth`, `/tasks`, `/subtasks`, `/settings`,
  `/schedule`, `/calendar`, `/categories`, `/habits`, `/priorities`, `/ws`, …) to the
  `server` container on `:3000`.
- Same origin ⇒ no CORS, and `VITE_API_URL` is empty (same-origin).

`docker-compose.yml` services:
- `db`: `postgres:16` with a named volume; `POSTGRES_PASSWORD` from `.env`.
- `server`: multi-stage build of `core` + `db` (prisma client) + `google` + `server`;
  entrypoint runs `prisma migrate deploy` then starts Fastify. Reads `JWT_SECRET`,
  `ENCRYPTION_KEY`, `GOOGLE_*`, `GOOGLE_REDIRECT_URI`, `WEB_CLIENT_URL`,
  `REGISTRATION_MODE`, `DATABASE_URL`.
- `caddy`: serves SPA + proxies API; depends on `server`.

Build artifacts: a `Dockerfile` for the server (Node) and a build stage for the web
(`vite build`); the web `dist/` is copied into the Caddy image (or a shared volume).

#### Tailscale exposure (auto-HTTPS, no port-forward)

- Run Tailscale on the Proxmox VM/LXC host; `tailscale serve https / http://localhost:<caddyPort>`
  publishes Caddy over the tailnet MagicDNS name with a Let's Encrypt cert Tailscale
  provisions automatically. (Sidecar `tailscale` container with `serve` is an alternative.)
- Result URL: `https://<machine>.<tailnet>.ts.net`.

#### Google OAuth config for Tailscale

- Authorized redirect URI: `https://<machine>.<tailnet>.ts.net/auth/google/callback`
  (= `GOOGLE_REDIRECT_URI`).
- Authorized JS origin: `https://<machine>.<tailnet>.ts.net` (= `WEB_CLIENT_URL`).
- OAuth consent screen may stay in **testing** with yourself as a test user (Calendar
  scope works for test users) while the tailnet is the access boundary. Going truly public
  later needs Google verification + Tailscale **Funnel** or a public domain.
- `*.ts.net` is a real HTTPS host, which Google's redirect-URI rules accept (verify during
  setup).

#### Secrets & migrations

- A git-ignored `.env` on the box holds all secrets; a tracked `.env.example` documents the
  keys with placeholder values (no real secrets — consistent with current repo hygiene:
  `.gitignore` already ignores `.env`/`.env.*` except `*.example`).
- `prisma migrate deploy` runs on server start; no manual DB steps.

## Out of scope (v1)

- Email verification and self-service password reset (deferred; admin CLI resets).
- Public exposure via Tailscale Funnel / public domain + Google OAuth verification (the
  path to truly unlimited public signup; revisit when flipping `REGISTRATION_MODE=open`).
- Rate limiting / brute-force protection on `/auth/login` — **note:** add basic
  per-IP/email throttling before opening registration to the public.
- Additional OAuth providers beyond Google.

## Testing strategy

- **Server:** register in each mode (closed→403, invite valid/invalid/expired/exhausted,
  open→create); login success + generic failure; invite consumption; Google callback
  branches (existing googleId login, link-by-email, new-email gated by mode, authenticated
  link); `set-password` then email+password login succeeds for a previously Google-only
  account; `PATCH /auth/email` uniqueness; `ensureUserDefaults` creates Settings exactly
  once; **cross-user isolation** (A cannot read/update B's task/habit/category/block/event
  by id).
- **Web:** SignIn password path, Register form happy path + gated/invalid-invite messages,
  Logout clears token, "Connect Google" entry visible for password users. Web tests run
  with `TZ=UTC`.
- Existing suite must stay green. Run tests **per package**.

## Risks / notes

- **Argon2 in the container:** pick a prebuilt-binary package so the image builds without a
  toolchain. Validated in the plan.
- **Google email retrieval:** linking-by-email depends on getting the verified email from
  Google; confirm the token service surfaces it.
- **JWT expiry introduction:** existing long-lived tokens become invalid after deploy;
  acceptable (re-login). Document it.
- **Plaintext-over-LAN concern is moot:** Tailscale Serve gives HTTPS end-to-end.

## Suggested phasing for implementation plans

This spec is large enough to split into two implementation plans, each independently
shippable and testable:
1. **Plan A — Auth & multi-user app** (schema/migration, password module, register/login,
   invite + modes, Google decoupling/linking, first-run defaults, isolation hardening,
   admin CLI, frontend signin/register/logout/connect-google, tests).
2. **Plan B — Containerized Proxmox/Tailscale deployment** (Dockerfiles, compose, Caddy,
   migrate-on-start, `.env.example`, Tailscale Serve + Google OAuth setup docs).
