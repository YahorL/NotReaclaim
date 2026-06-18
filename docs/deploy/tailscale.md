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
host (see google-oauth.md) and `docker compose up -d` to apply.

(If the host runs an older Tailscale, use the equivalent form:
`sudo tailscale serve https / http://127.0.0.1:8080`.)

## Alternative: Tailscale as a compose sidecar
Instead of host-level Tailscale, a `tailscale/tailscale` sidecar container with
`TS_SERVE_CONFIG` can own the serve mapping. Heavier to wire up; the host approach above is
simplest for a single box.

## Future: public access
When you flip `REGISTRATION_MODE=open` for public signup, swap `tailscale serve` for
`tailscale funnel 8080` (exposes to the public internet over HTTPS) or move to a public
domain + a TLS-terminating Caddy. Public Google use then also needs OAuth verification.
