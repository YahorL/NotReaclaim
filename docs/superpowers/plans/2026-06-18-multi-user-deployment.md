# Plan B — Containerized Proxmox/Tailscale Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package NotReclaim as a Docker Compose stack (Postgres + Fastify API + Caddy serving the SPA and proxying the API on one origin), run it on a Proxmox VM/LXC, and expose it over Tailscale Serve with automatic HTTPS — with DB migrations applied on container start and all secrets kept in a git-ignored `.env`.

**Architecture:** A single multi-stage `Dockerfile` builds the monorepo once and produces two images via build targets: `server` (Node runtime running `prisma migrate deploy` then `node packages/server/dist/server.js`) and `web` (Caddy serving `packages/web/dist` and reverse-proxying API paths to `server:3000`). Postgres runs as a third service with a named volume. Caddy listens on plain HTTP `:8080` bound to `127.0.0.1`; Tailscale Serve on the host terminates TLS and publishes it on the tailnet MagicDNS name. Same-origin (SPA + API behind Caddy) means no CORS and an empty `VITE_API_URL`.

**Tech Stack:** Docker + Docker Compose, `node:20-bookworm-slim` (glibc — required so Prisma engines and `@node-rs/argon2` gnu prebuilt binaries load), `postgres:16`, `caddy:2.8-alpine`, Tailscale.

**Assumes Plan A is already merged** — i.e. the auth endpoints (`/auth/login`, `/auth/register`, `/auth/set-password`, `/auth/email`), the `REGISTRATION_MODE` config, the `InviteCode` migration, and the admin CLI at `packages/server/scripts/admin.mjs` all exist. This plan does not re-implement auth.

---

### Task 1: Multi-stage Dockerfile (build → server + web)

**Files:**
- Create: `Dockerfile` (repo root)

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1

###############################################################################
# Stage 1: build — install workspace deps, generate the Prisma client, compile
# every package in dependency order, and build the web SPA.
# glibc (Debian bookworm) base: Prisma query/migration engines and the
# @node-rs/argon2 *-linux-x64-gnu prebuilt binary both load without a toolchain.
###############################################################################
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json       packages/core/package.json
COPY packages/scheduler/package.json  packages/scheduler/package.json
COPY packages/google/package.json     packages/google/package.json
COPY packages/db/package.json         packages/db/package.json
COPY packages/server/package.json     packages/server/package.json
COPY packages/web/package.json        packages/web/package.json
RUN npm ci

# Copy the rest of the source.
COPY . .

# Generate the Prisma client (both the db tsc build and runtime migrate need it).
RUN npm run prisma:generate -w @notreclaim/db

# Compile in dependency order, then build the SPA (outputs packages/web/dist).
RUN npm run build -w @notreclaim/core \
 && npm run build -w @notreclaim/scheduler \
 && npm run build -w @notreclaim/google \
 && npm run build -w @notreclaim/db \
 && npm run build -w @notreclaim/server \
 && npm run build -w @notreclaim/web

###############################################################################
# Stage 2: server — Node runtime for the Fastify API. Retains node_modules
# (incl. the Prisma CLI) so the entrypoint can run `prisma migrate deploy`.
###############################################################################
FROM node:20-bookworm-slim AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY docker/server-entrypoint.sh /usr/local/bin/server-entrypoint.sh
RUN chmod +x /usr/local/bin/server-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/server-entrypoint.sh"]

###############################################################################
# Stage 3: web — Caddy serving the built SPA + reverse-proxying the API.
###############################################################################
FROM caddy:2.8-alpine AS web
COPY --from=build /app/packages/web/dist /srv
COPY docker/Caddyfile /etc/caddy/Caddyfile
EXPOSE 8080
```

- [ ] **Step 2: Verify the Dockerfile parses (build the server target)**

Run (the next tasks create the files this build COPYs, so run this only after Task 3):
`docker build --target server -t notreclaim-server:test .`
Expected: build completes with `naming to docker.io/library/notreclaim-server:test`. If `@node-rs/argon2` fails to load at runtime, the base is not glibc — keep `node:20-bookworm-slim` (NOT alpine).

> Note: `node_modules` is copied wholesale (keeps the Prisma CLI for migrations). This trades image size for correctness on a single-box self-hosted deploy; pruning dev deps is a later optimization.

---

### Task 2: Caddyfile (serve SPA + proxy API, one origin)

**Files:**
- Create: `docker/Caddyfile`

The server mounts exactly these route groups (from `packages/server/src/app.ts`): auth, tasks, subtasks, habits, settings, schedule, calendar, categories, ws. There is **no** `/priorities` server route. `/auth/callback` is a **client-side** SPA route (the redirect-with-token landing) and MUST be served by the SPA, so the API matcher lists the server's real auth endpoints (`/auth/google*`, `/auth/login`, `/auth/register`, `/auth/set-password`, `/auth/email`) and deliberately omits `/auth/callback`.

- [ ] **Step 1: Write the Caddyfile**

```
{
	admin off
	# TLS is terminated by Tailscale Serve on the host; Caddy serves plain HTTP.
	auto_https off
}

:8080 {
	encode gzip

	# API endpoints proxied to the Fastify server. Single `path` matcher = OR
	# over all listed prefixes. /auth/callback is intentionally NOT here (SPA route).
	@api path /auth/google* /auth/login /auth/register /auth/set-password /auth/email /tasks* /subtasks* /habits* /settings* /schedule* /calendar* /categories* /ws*

	handle @api {
		reverse_proxy server:3000
	}

	# Everything else: the SPA, with client-side-routing fallback to index.html
	# (covers /signin, /register, /auth/callback, /app/*, etc.).
	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 2: Verify the Caddyfile is valid**

Run: `docker run --rm -v "$PWD/docker/Caddyfile:/etc/caddy/Caddyfile" caddy:2.8-alpine caddy validate --config /etc/caddy/Caddyfile`
Expected: `Valid configuration`.

---

### Task 3: Server entrypoint (migrate-on-start)

**Files:**
- Create: `docker/server-entrypoint.sh`

- [ ] **Step 1: Write the entrypoint**

```sh
#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations..."
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

echo "[entrypoint] Starting NotReclaim API on :${PORT:-3000}..."
exec node packages/server/dist/server.js
```

- [ ] **Step 2: Verify it is syntactically valid**

Run: `sh -n docker/server-entrypoint.sh && echo OK`
Expected: `OK`. (It runs from WORKDIR `/app`; `npx prisma` resolves the CLI from the copied `node_modules`; `migrate deploy` is non-interactive and applies only committed migrations.)

---

### Task 4: docker-compose.yml

**Files:**
- Create: `docker-compose.yml` (repo root)

- [ ] **Step 1: Write the compose file**

```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: notreclaim
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      POSTGRES_DB: notreclaim
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U notreclaim -d notreclaim"]
      interval: 5s
      timeout: 5s
      retries: 10

  server:
    build:
      context: .
      dockerfile: Dockerfile
      target: server
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      # Composed from POSTGRES_PASSWORD so the DB password lives in one place.
      DATABASE_URL: postgresql://notreclaim:${POSTGRES_PASSWORD}@db:5432/notreclaim
      JWT_SECRET: ${JWT_SECRET:?set JWT_SECRET in .env}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?set ENCRYPTION_KEY in .env}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET}
      GOOGLE_REDIRECT_URI: ${GOOGLE_REDIRECT_URI}
      WEB_CLIENT_URL: ${WEB_CLIENT_URL}
      REGISTRATION_MODE: ${REGISTRATION_MODE:-closed}
      PORT: "3000"
      POLL_INTERVAL_MS: ${POLL_INTERVAL_MS:-300000}
    expose:
      - "3000"

  caddy:
    build:
      context: .
      dockerfile: Dockerfile
      target: web
    restart: unless-stopped
    depends_on:
      - server
    ports:
      # Host-local only; Tailscale Serve on the host proxies to this.
      - "127.0.0.1:8080:8080"
    volumes:
      - caddy-data:/data
      - caddy-config:/config

volumes:
  db-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 2: Verify compose interpolates and validates**

Run (with a populated `.env` from Task 5): `docker compose config`
Expected: the fully-resolved config prints with no `WARN`/`error` about unset required vars. `DATABASE_URL` should show `postgresql://notreclaim:<pw>@db:5432/notreclaim`.

---

### Task 5: `.env.example` and `.gitignore` confirmation

**Files:**
- Create: `.env.example` (repo root, tracked)
- Verify: `.gitignore` already ignores `.env`/`.env.*`

- [ ] **Step 1: Write `.env.example`**

```dotenv
# Copy to .env and fill in real values. .env is git-ignored (see .gitignore).
# Generate secrets with:
#   JWT_SECRET:      openssl rand -hex 32
#   ENCRYPTION_KEY:  openssl rand -base64 32      (must decode to exactly 32 bytes)
#   POSTGRES_PASSWORD: openssl rand -hex 24

# --- Database ---
# Only POSTGRES_PASSWORD is needed; docker-compose builds DATABASE_URL from it.
POSTGRES_PASSWORD=change-me-postgres-password
# DATABASE_URL is set automatically by docker-compose to:
#   postgresql://notreclaim:${POSTGRES_PASSWORD}@db:5432/notreclaim
# (Set DATABASE_URL yourself only if running the server outside compose.)

# --- Auth / crypto ---
JWT_SECRET=change-me-64-hex-chars
ENCRYPTION_KEY=change-me-base64-32-bytes

# --- Registration gate: closed | invite | open ---
REGISTRATION_MODE=closed

# --- Google OAuth (Calendar). Use your Tailscale MagicDNS HTTPS URL. ---
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://<machine>.<tailnet>.ts.net/auth/google/callback
WEB_CLIENT_URL=https://<machine>.<tailnet>.ts.net

# --- Misc ---
POLL_INTERVAL_MS=300000
```

- [ ] **Step 2: Confirm `.env` is git-ignored**

Run: `git check-ignore -v .env`
Expected: a line like `.gitignore:5:.env<TAB>.env` (a matching rule). If it prints nothing, STOP and add `.env` to `.gitignore` before continuing — real secrets must never be tracked. `.env.example` is the only tracked env artifact.

- [ ] **Step 3: Commit the deployment files**

```bash
git add Dockerfile docker/Caddyfile docker/server-entrypoint.sh docker-compose.yml .env.example
git commit -m "$(cat <<'EOF'
build(deploy): Docker Compose stack (Postgres + API + Caddy) for self-hosting

Multi-stage Dockerfile (server + web targets), Caddy single-origin reverse
proxy, migrate-on-start entrypoint, and .env.example. Secrets stay in the
git-ignored .env.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Build, generate secrets, and bring the stack up

**Files:** none (operational)

- [ ] **Step 1: Create `.env` from the template and fill secrets**

```bash
cp .env.example .env
# Generate and paste values:
openssl rand -hex 32      # -> JWT_SECRET
openssl rand -base64 32   # -> ENCRYPTION_KEY (32 bytes)
openssl rand -hex 24      # -> POSTGRES_PASSWORD
```
Set `GOOGLE_REDIRECT_URI`/`WEB_CLIENT_URL` to your MagicDNS URL (Task 8 tells you the hostname). Leave `GOOGLE_*` client values until Task 9 if you want; the server requires them at boot, so fill placeholders that are syntactically present or complete Task 9 first.

- [ ] **Step 2: Build the images**

Run: `docker compose build`
Expected: both `server` and `caddy` images build successfully.

- [ ] **Step 3: Start the stack**

Run: `docker compose up -d`
Then: `docker compose logs server | grep -i migrat`
Expected: the entrypoint logs `Applying database migrations...` and Prisma reports migrations applied (or "No pending migrations") on a fresh DB, then the API starts.

- [ ] **Step 4: Verify the API answers behind Caddy (same origin)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/tasks`
Expected: `401` (guarded route, no token) — proves Caddy proxied `/tasks` to the server.
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/`
Expected: `200` — Caddy served the SPA `index.html`.

---

### Task 7: Bootstrap the owner account + smoke tests

**Files:** none (operational; uses the Plan A admin CLI)

- [ ] **Step 1: Create your owner account (closed mode → CLI bootstrap)**

Run (Google-only owner account; password optional):
`docker compose exec server node packages/server/scripts/admin.mjs create-user --email you@gmail.com --admin`
Expected: prints the created user id. (Add `--password '...'` if you also want email+password login immediately.)

- [ ] **Step 2: Smoke-test sign-in and persistence**

1. Open `https://<machine>.<tailnet>.ts.net` (after Task 8). Click **Sign in with Google**; it should link to your CLI-created account by email and land you in the app.
2. Create a task in the UI.
3. Restart and confirm the task survives the volume:
   `docker compose restart server` then reload — the task is still there. Also `docker compose down && docker compose up -d` must NOT lose data (named volume `db-data`).

- [ ] **Step 3: Verify migrate-on-start works on a truly fresh DB**

Run (destroys data — only for this check):
`docker compose down -v && docker compose up -d && docker compose logs server | grep -i migrat`
Expected: Prisma applies all migrations from scratch and the API starts healthy. Re-create the owner account afterward (Step 1).

---

### Task 8: Tailscale Serve runbook (auto-HTTPS, no port-forward)

**Files:**
- Create: `docs/deploy/tailscale.md` (operator runbook)

- [ ] **Step 1: Write the runbook**

Content to write (complete file):

```markdown
# Exposing NotReclaim over Tailscale (auto-HTTPS)

Run these on the Proxmox VM/LXC host that runs the Docker stack.

## Prerequisites
- Tailscale installed and `tailscale up` completed on this host.
- In the Tailscale admin console: **MagicDNS** enabled and **HTTPS Certificates** enabled
  (Settings → Features). This lets Tailscale provision Let's Encrypt certs for `*.ts.net`.

## Find your MagicDNS name
    tailscale status            # shows this machine's name
    # Full host is: <machine>.<tailnet>.ts.net

## Publish Caddy (listening on 127.0.0.1:8080) over HTTPS
    sudo tailscale serve --bg 8080
    tailscale serve status
Expected `serve status`: `https://<machine>.<tailnet>.ts.net (tailnet only)` →
`http://127.0.0.1:8080`.

Browse to `https://<machine>.<tailnet>.ts.net` from any device on your tailnet — valid
HTTPS, no port-forwarding. Set `GOOGLE_REDIRECT_URI` and `WEB_CLIENT_URL` in `.env` to this
host (see Task 9) and `docker compose up -d` to apply.

## Alternative: Tailscale as a compose sidecar
Instead of host-level Tailscale, a `tailscale/tailscale` sidecar container with
`TS_SERVE_CONFIG` can own the serve mapping. Heavier to wire up; the host approach above is
simplest for a single box.

## Future: public access
When you flip `REGISTRATION_MODE=open` for public signup, swap `tailscale serve` for
`tailscale funnel 8080` (exposes to the public internet over HTTPS) or move to a public
domain + a TLS-terminating Caddy. Public Google use then also needs OAuth verification.
```

- [ ] **Step 2: Verify HTTPS end-to-end**

Run from a tailnet device: `curl -sI https://<machine>.<tailnet>.ts.net/ | head -n1`
Expected: `HTTP/2 200`. A `curl` of `/tasks` returns `401` (proxied API).

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/deploy/tailscale.md
git commit -m "$(cat <<'EOF'
docs(deploy): Tailscale Serve runbook for auto-HTTPS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Google OAuth console configuration

**Files:**
- Create: `docs/deploy/google-oauth.md` (operator runbook)

- [ ] **Step 1: Write the runbook**

Content to write (complete file):

```markdown
# Google OAuth setup for NotReclaim (Tailscale)

In Google Cloud Console → APIs & Services:

1. **OAuth consent screen**
   - User type: External. Keep publishing status **Testing**.
   - Add your Google account under **Test users** (Calendar scopes work for test users
     without Google verification while in Testing).
   - Scopes: the Calendar scope(s) the app already requests.

2. **Credentials → Create OAuth client ID → Web application**
   - **Authorized JavaScript origins:** `https://<machine>.<tailnet>.ts.net`
   - **Authorized redirect URIs:** `https://<machine>.<tailnet>.ts.net/auth/google/callback`
   - Copy the **Client ID** and **Client secret** into `.env`
     (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).

3. Set in `.env`:
       GOOGLE_REDIRECT_URI=https://<machine>.<tailnet>.ts.net/auth/google/callback
       WEB_CLIENT_URL=https://<machine>.<tailnet>.ts.net
   then `docker compose up -d` to apply.

Notes
- `*.ts.net` is a real HTTPS host, which Google accepts as a redirect URI. (If Google ever
  rejects it, fall back to Tailscale Funnel + a custom domain.)
- Going public (REGISTRATION_MODE=open, many users) requires moving the consent screen to
  **In production** and passing Google verification (incl. a CASA assessment for Calendar).
```

- [ ] **Step 2: Verify the OAuth round-trip**

After filling `.env` and `docker compose up -d`: open `https://<machine>.<tailnet>.ts.net`,
click **Sign in with Google**, complete consent. Expected: redirect back to
`/auth/callback` with a token and you land authenticated. A mismatch error here means the
redirect URI in the console ≠ `GOOGLE_REDIRECT_URI`.

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/deploy/google-oauth.md
git commit -m "$(cat <<'EOF'
docs(deploy): Google OAuth setup runbook for Tailscale MagicDNS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage** (against `2026-06-18-multi-user-auth-and-deployment-design.md`, Phase 2):
- Server Dockerfile (multi-stage, glibc) ✓ Task 1; Web build + Caddy single-origin proxy ✓ Tasks 1–2; docker-compose (db + server + caddy, volume, healthcheck, internal Postgres) ✓ Task 4; migrate-on-start entrypoint ✓ Task 3; `.env.example` + `.gitignore` confirmation ✓ Task 5; Tailscale Serve ✓ Task 8; Google OAuth config ✓ Task 9; bootstrap + smoke test ✓ Tasks 6–7. All Phase-2 bullets covered.

**Placeholder scan:** Every infra file (Dockerfile, Caddyfile, entrypoint, compose, `.env.example`) is given in full. `<machine>.<tailnet>.ts.net` is a genuine per-user value the operator substitutes, not a TODO — flagged as such at each use.

**Consistency check (names/ports/env vars across files):**
- Service names `db` / `server` / `caddy` are consistent in compose, Caddyfile (`server:3000`), and runbooks.
- Ports: server `3000` (Dockerfile EXPOSE, compose `expose`, Caddy `reverse_proxy server:3000`, entrypoint `PORT`); Caddy `8080` (Dockerfile EXPOSE, Caddyfile `:8080`, compose `127.0.0.1:8080:8080`, `tailscale serve 8080`). Consistent.
- Env var names match the code read during authoring: `JWT_SECRET`, `PORT`, `POLL_INTERVAL_MS`, `WEB_CLIENT_URL` (`packages/server/src/config.ts`); `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `ENCRYPTION_KEY` (`packages/google/src/config.ts`); `DATABASE_URL` (`packages/db/src/config.ts`); `REGISTRATION_MODE` (Plan A). `DATABASE_URL` is composed from `POSTGRES_PASSWORD` in compose — documented in `.env.example`.
- Build command `node packages/server/dist/server.js` matches `packages/server/package.json` `start` (`node dist/server.js`, run from repo root here). Web output `packages/web/dist` = Vite default (no `outDir` override). API matcher omits `/auth/callback` (SPA route, confirmed in `vite.config.ts`) and omits `/priorities` (no such server route in `app.ts`).

**Assumptions / open questions for the executor:**
1. **Workspace build order** is pinned explicitly in the Dockerfile (core → scheduler → google → db → server → web) to avoid clean-container ordering surprises; if any package's `tsc` still can't resolve a sibling's `dist`, add the missing dependency build before it.
2. **`@node-rs/argon2` / Prisma engine** correctness depends on the glibc base — do not switch to an alpine/musl image without swapping to the corresponding musl prebuilds.
3. **`VITE_API_URL` must be empty at build time** so the SPA calls same-origin (it is unset in the build, which is correct); do not pass it as a build arg.
4. **`tailscale serve` syntax** can vary by Tailscale version; `tailscale serve --bg 8080` is current — if the host runs an older version, use the equivalent `tailscale serve https / http://127.0.0.1:8080` form.
5. Server requires `GOOGLE_*` + `ENCRYPTION_KEY` at boot (it throws otherwise), so Task 9 must be completed (or valid values present) before the stack stays up.
