# NotReclaim — Proxmox deployment handoff

Single-page runbook for standing up NotReclaim on a Proxmox host. Self-contained; links the
deeper runbooks (`tailscale.md`, `google-oauth.md`, `auto-deploy.md`) where useful.

## What you're deploying
A Docker Compose stack on one origin:
- **db** — `postgres:16`, data in a named volume `db-data`.
- **server** — Fastify API (built from the repo `Dockerfile`, target `server`). Runs
  `prisma migrate deploy` on start, then listens on container port 3000 (not published).
- **caddy** — serves the built React SPA and reverse-proxies the API on one origin. Published
  to **`127.0.0.1:8080`** only (host-local). Tailscale Serve fronts it with HTTPS.

No inbound ports are opened to the internet. Access is via Tailscale (`*.ts.net`, auto-HTTPS).
The repo is **public**, but contains no secrets — all secrets live in a git-ignored `.env` on
the host. Deployment is **pull-based**: the host polls `origin/main` and rebuilds when it moves.

## 0. Provision the container (Proxmox-specific)

You have two options. **A VM is the low-friction choice**; an LXC works but needs Docker-in-LXC
tweaks.

**Option A — VM (recommended):** Debian 12 or Ubuntu 22.04+ VM. 2 vCPU / 4 GB RAM / 20 GB disk
is plenty. Docker works out of the box. Skip the LXC caveats below.

**Option B — LXC container (what you asked for):**
- Use a **Debian 12 or Ubuntu** template (glibc-based). **Do not use Alpine** — the API uses
  `@node-rs/argon2` gnu prebuilt binaries that need glibc; the Docker image is
  `node:20-bookworm-slim` so the *container image* is fine regardless, but the host distro
  choice still matters least for Docker — the real constraint is Docker-in-LXC support below.
- Docker inside an unprivileged LXC needs nesting + keyctl. On the **Proxmox host**, edit
  `/etc/pve/lxc/<CTID>.conf` and add:
  ```
  features: nesting=1,keyctl=1
  ```
  (Or in the GUI: container → Options → Features → enable **Nesting** and **keyctl**.) Reboot
  the container. A privileged container also works but nesting+keyctl on unprivileged is the
  safer default. If `docker info` complains about overlay2/storage, that's the symptom of
  missing nesting.
- Resources: 2 cores / 4 GB / 20 GB disk.

Either way, the rest of the steps are identical and run **inside** the VM/LXC.

## 1. Install Docker (in the VM/LXC)
Install Docker Engine + the Compose plugin (Debian/Ubuntu):
```sh
curl -fsSL https://get.docker.com | sh
docker --version && docker compose version   # confirm both exist
```
Run the rest as root (or a user in the `docker` group).

## 2. Install + bring up Tailscale on the host
```sh
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale status            # note this machine's name → <machine>.<tailnet>.ts.net
```
In the Tailscale **admin console**: enable **MagicDNS** and **HTTPS Certificates**
(Settings → Features). Full details: `docs/deploy/tailscale.md`.

## 3. Clone the repo where auto-deploy expects it
```sh
git clone https://github.com/YahorL/NotReaclaim.git /opt/notreclaim
cd /opt/notreclaim
chmod +x deploy/auto-deploy.sh
```
(If you clone elsewhere, you must edit `WorkingDirectory` + `ExecStart` in
`deploy/notreclaim-deploy.service`, or export `NOTRECLAIM_DIR` for the script.)

## 4. Create Google OAuth credentials
In Google Cloud Console (consent screen stays in **Testing**; add your Google account as a
test user). Create a **Web application** OAuth client with:
- **Authorized redirect URI:** `https://<machine>.<tailnet>.ts.net/auth/google/callback`
- **Authorized JS origin:** `https://<machine>.<tailnet>.ts.net`

Copy the Client ID + secret for the next step. Full details: `docs/deploy/google-oauth.md`.

## 5. Write `.env` (never committed)
```sh
cp .env.example .env
```
Then fill it in. Generate secrets:
```sh
openssl rand -hex 32      # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY  (must decode to exactly 32 bytes)
openssl rand -hex 24      # POSTGRES_PASSWORD
```
Set in `.env`:
- `POSTGRES_PASSWORD` — generated above (compose builds `DATABASE_URL` from it).
- `JWT_SECRET`, `ENCRYPTION_KEY` — generated above.
- `REGISTRATION_MODE=closed` — keep closed; you bootstrap your own account via CLI (step 7).
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from step 4.
- `GOOGLE_REDIRECT_URI=https://<machine>.<tailnet>.ts.net/auth/google/callback`
- `WEB_CLIENT_URL=https://<machine>.<tailnet>.ts.net`

## 6. Build and start the stack (once, by hand)
```sh
docker compose build        # first build is slow; later builds are layer-cached
docker compose up -d
docker compose ps           # db healthy, server up, caddy up
docker compose logs -f server   # confirm "prisma migrate deploy" ran and it's listening
```
The server runs migrations automatically on start, so the schema is created on first boot.

## 7. Publish over HTTPS via Tailscale + bootstrap the owner account
```sh
sudo tailscale serve --bg 8080
tailscale serve status      # expect https://<machine>.<tailnet>.ts.net → 127.0.0.1:8080
```
Create your owner account (registration is closed, so do it via the admin CLI inside the
server container):
```sh
docker compose exec server node packages/server/scripts/admin.mjs \
  create-user --email you@example.com --password 'your-strong-password' --admin
```
(Omit `--password` for a Google-only account that links by email on first Google sign-in.
The CLI also has `set-password` and `create-invite`.)

Now browse to `https://<machine>.<tailnet>.ts.net` from any device on your tailnet and log in.

## 8. Enable auto-deploy (optional, recommended)
```sh
cp deploy/notreclaim-deploy.service /etc/systemd/system/
cp deploy/notreclaim-deploy.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now notreclaim-deploy.timer
```
The timer polls `origin/main` every ~3 min and, only when it moves, fast-forwards and rebuilds
(`docker compose up -d --build`). Your `.env` is never touched. Operate it:
```sh
systemctl list-timers notreclaim-deploy       # next/last run
journalctl -u notreclaim-deploy -f            # live deploy logs
systemctl start notreclaim-deploy.service     # deploy NOW
systemctl disable --now notreclaim-deploy.timer  # pause
```
Full details + the "no test gate" caveat: `docs/deploy/auto-deploy.md`.

## Checklist
- [ ] Container has glibc distro; if LXC, `nesting=1,keyctl=1` set + rebooted
- [ ] `docker` + `docker compose` both work
- [ ] Tailscale up; MagicDNS + HTTPS certs enabled in admin console
- [ ] Repo cloned to `/opt/notreclaim`
- [ ] Google OAuth client created with the `.ts.net` redirect URI
- [ ] `.env` filled (secrets generated; `REGISTRATION_MODE=closed`)
- [ ] `docker compose up -d` → db healthy, migrations ran, all three services up
- [ ] `tailscale serve --bg 8080` → HTTPS URL resolves
- [ ] Owner account created via admin CLI; login works in the browser
- [ ] Auto-deploy timer enabled (optional)

## Gotchas / notes
- **Caddyfile not validated on a real host yet** — if Caddy fails to start, run
  `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` and report the
  error. The `/tasks` `/habits` `/settings` paths are deliberately content-negotiated (proxy
  API requests, serve the SPA on browser navigations) — don't "simplify" that matcher away.
- **Docker build not verified on this box** (no Docker on the dev machine). If `docker compose
  build` fails, the build order in `Dockerfile` is scheduler→db→core→google→server→web; surface
  the failing stage.
- **`*.ts.net` as a Google redirect** is a real HTTPS host and Google accepts it. If Google
  ever rejects it, fall back to Tailscale Funnel + a custom domain.
- **Going public later** (`REGISTRATION_MODE=open`): do the still-open hardening first
  (login rate-limiting, email verification + self-service password reset, change-email re-auth),
  switch `tailscale serve` → `tailscale funnel`, and move the Google consent screen to
  production (needs verification + CASA for Calendar scopes).
- **Backups:** the only stateful thing is the `db-data` volume. Back it up with
  `docker compose exec db pg_dump -U notreclaim notreclaim > backup.sql`.
