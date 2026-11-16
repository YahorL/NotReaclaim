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

function eventsPath(calendarId: string): string {
  return `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`;
}

function eventPath(calendarId: string, googleEventId: string): string {
  return `${eventsPath(calendarId)}/${encodeURIComponent(googleEventId)}`;
}

function toEventBody(event: GoogleEventWrite) {
  return {
    summary: event.summary,
    start: { dateTime: event.startDateTime },
    end: { dateTime: event.endDateTime },
  };
}

/**
 * One Calendar REST call with Bearer auth; `json`, when given, is sent as a JSON body.
 * A non-ok response throws GoogleApiError unless its status is in `handled`, in which case
 * it is returned for the caller to interpret.
 */
async function calendarFetch(
  accessToken: string,
  url: string | URL,
  init: { method?: string; json?: unknown } = {},
  handled: number[] = [],
): Promise<Response> {
  const hasBody = init.json !== undefined;
  const res = await fetch(url, {
    ...(init.method ? { method: init.method } : {}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(init.json) } : {}),
  });
  if (!res.ok && !handled.includes(res.status)) throw new GoogleApiError(res.status, await res.text());
  return res;
}

async function writeEvent(
  method: 'PUT' | 'PATCH',
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  event: GoogleEventWrite,
): Promise<void> {
  await calendarFetch(accessToken, eventPath(calendarId, googleEventId), { method, json: toEventBody(event) });
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
      const url = new URL(eventsPath(calendarId));
      url.searchParams.set('singleEvents', 'true');
      if (syncToken) {
        url.searchParams.set('syncToken', syncToken);
        url.searchParams.set('showDeleted', 'true');
      } else if (timeMin) {
        url.searchParams.set('timeMin', timeMin);
      }
      if (timeMax && !syncToken) url.searchParams.set('timeMax', timeMax);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await calendarFetch(accessToken, url, {}, [410]);
      if (res.status === 410) throw new SyncTokenExpiredError();

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
      const res = await calendarFetch(accessToken, `${CALENDAR_API}/calendars`, { method: 'POST', json: { summary } });
      const data = (await res.json()) as { id: string };
      return { calendarId: data.id };
    },

    async insertEvent(accessToken, calendarId, event: GoogleEventWrite) {
      const res = await calendarFetch(accessToken, eventsPath(calendarId), { method: 'POST', json: toEventBody(event) });
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
      // Already gone (404/410) counts as deleted.
      await calendarFetch(accessToken, eventPath(calendarId, googleEventId), { method: 'DELETE' }, [404, 410]);
    },
  };
}
