import { OAuth2Client } from 'google-auth-library';
import type { GoogleClient, GoogleEvent, GoogleEventWrite, GoogleTokens, ListEventsArgs, ListEventsResult } from './client.js';
import { GoogleApiError, GoogleAuthError, GoogleGrantRevokedError, SyncTokenExpiredError } from './errors.js';

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
  updated?: string;
}

/** OAuth error bodies are JSON, but read a raw string body too rather than miss a revocation. */
function oauthErrorCode(data: unknown): string | undefined {
  let body = data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return undefined; }
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const code = (body as { error?: unknown }).error;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Distinguish a dead grant from a bad day at Google. google-auth-library rejects with a
 * GaxiosError carrying `response.status` + parsed `response.data` (and, in newer versions,
 * a top-level `status`); a DNS failure or timeout rejects with a bare Error and no response
 * at all. Only HTTP 400/401 + `error: "invalid_grant"` means the refresh token is gone —
 * 5xx, 429 and network errors are transient and must not raise a "reconnect" alert.
 */
function isRevokedGrant(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { response, status } = error as { response?: { status?: number; data?: unknown }; status?: number };
  const httpStatus = response?.status ?? status;
  if (httpStatus !== 400 && httpStatus !== 401) return false;
  return oauthErrorCode(response?.data) === 'invalid_grant';
}

function mapEvent(item: RawGoogleEvent): GoogleEvent {
  return {
    id: item.id,
    status: item.status ?? 'confirmed',
    summary: item.summary ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
    updated: item.updated,
  };
}

async function writeEvent(
  method: 'PUT' | 'PATCH',
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  event: GoogleEventWrite,
): Promise<void> {
  const body = {
    summary: event.summary,
    start: { dateTime: event.startDateTime },
    end: { dateTime: event.endDateTime },
  };
  const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new GoogleApiError(res.status, await res.text());
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
        emailVerified: payload.email_verified === true,
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
        const message = error instanceof Error ? error.message : 'Token refresh failed';
        throw isRevokedGrant(error) ? new GoogleGrantRevokedError(message) : new GoogleAuthError(message);
      }
    },

    async listEvents({ accessToken, calendarId, syncToken, pageToken, timeMin, timeMax }: ListEventsArgs): Promise<ListEventsResult> {
      const url = new URL(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      if (syncToken) {
        url.searchParams.set('syncToken', syncToken);
        url.searchParams.set('showDeleted', 'true');
      } else if (timeMin) {
        url.searchParams.set('timeMin', timeMin);
      }
      if (timeMax && !syncToken) url.searchParams.set('timeMax', timeMax);
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

    async createCalendar(accessToken, summary) {
      const res = await fetch(`${CALENDAR_API}/calendars`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
      const data = (await res.json()) as { id: string };
      return { calendarId: data.id };
    },

    async insertEvent(accessToken, calendarId, event: GoogleEventWrite) {
      const body = {
        summary: event.summary,
        start: { dateTime: event.startDateTime },
        end: { dateTime: event.endDateTime },
      };
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
      const data = (await res.json()) as { id: string };
      return { googleEventId: data.id };
    },

    /** Full replace (PUT): only for events NotReclaim wholly owns, e.g. scheduled blocks. */
    updateEvent(accessToken, calendarId, googleEventId, event: GoogleEventWrite) {
      return writeEvent('PUT', accessToken, calendarId, googleEventId, event);
    },

    /**
     * Merge (PATCH): leaves Google-side fields we never send — description, location,
     * attendees, reminders — intact. Use this for events the user can also edit in Google.
     */
    patchEvent(accessToken, calendarId, googleEventId, event: GoogleEventWrite) {
      return writeEvent('PATCH', accessToken, calendarId, googleEventId, event);
    },

    async deleteEvent(accessToken, calendarId, googleEventId) {
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 404 || res.status === 410) return;
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
    },
  };
}
