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
