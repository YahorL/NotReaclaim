# Automatic deployment (pull-based)

The host polls GitHub every few minutes and, only when `main` has moved, fast-forwards
and rebuilds the stack. Chosen because the box is **Tailscale-only** (no inbound) and the
repo is **public** — a pull-based deploy needs no open ports and has no fork-PR exposure
(unlike a self-hosted GitHub Actions runner). Your `.env` is never touched; it's git-ignored
and lives only on the host.

## How it works
- `deploy/auto-deploy.sh` — `git fetch origin main`; if HEAD != origin/main, `git pull
  --ff-only` then `docker compose up -d --build` (and `docker image prune -f`).
- `deploy/notreclaim-deploy.service` — oneshot unit that runs the script.
- `deploy/notreclaim-deploy.timer` — fires 2 min after boot, then every 3 min.

## Install (on the Proxmox LXC/VM, as root)
```sh
# 1. Clone where the service expects it (or edit the paths in the .service file).
git clone https://github.com/YahorL/NotReaclaim.git /opt/notreclaim
cd /opt/notreclaim
chmod +x deploy/auto-deploy.sh

# 2. Create .env and bring the stack up once by hand (see docs/deploy/tailscale.md
#    + google-oauth.md). Confirm `docker compose up -d` works before automating.

# 3. Install the systemd units. If you cloned somewhere other than /opt/notreclaim,
#    edit WorkingDirectory + ExecStart in the .service first.
cp deploy/notreclaim-deploy.service /etc/systemd/system/
cp deploy/notreclaim-deploy.timer   /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now notreclaim-deploy.timer
```

## Operate
```sh
systemctl list-timers notreclaim-deploy          # next/last run
journalctl -u notreclaim-deploy -f               # live deploy logs
systemctl start notreclaim-deploy.service        # deploy NOW (don't wait for the timer)
systemctl disable --now notreclaim-deploy.timer  # pause auto-deploy
```

## Notes
- **Latency:** up to ~3 min after you push to `main`. For an instant deploy, run the service
  manually (above).
- **First build is slow; later builds are fast** thanks to Docker layer caching.
- **A bad commit auto-deploys too** — there's no test gate here. The repo's own checks should
  gate `main`; or run `systemctl start notreclaim-deploy.service` manually after verifying.
- **Want push-instant instead?** A self-hosted GitHub Actions runner gives push-triggered
  deploys, but on a *public* repo you must restrict it to `push` events and block fork-PR
  runs (or make the repo private). Ask and I'll add that workflow instead.
