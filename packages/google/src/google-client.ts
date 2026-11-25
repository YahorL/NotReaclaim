import { OAuth2Client } from 'google-auth-library';
import type { GoogleClient, GoogleEvent, GoogleEventWrite, GoogleTokens, ListEventsArgs, ListEventsResult } from './client.js';
import { GoogleApiError, GoogleAuthError, GoogleGrantRevokedError, GoogleTimeoutError, SyncTokenExpiredError } from './errors.js';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar'];
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
/** Every Google request (Calendar and OAuth) is cut off after this long. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  /** Per-request timeout; defaults to 15 s. Injectable so tests need not wait for it. */
  requestTimeoutMs?: number;
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

/** A Calendar response whose body has already been read in full. */
interface CalendarResponse {
  status: number;
  json<T>(): T;
}

/**
 * One Calendar REST call with Bearer auth; `json`, when given, is sent as a JSON body.
 * A non-ok response throws GoogleApiError unless its status is in `handled`, in which case
 * it is returned for the caller to interpret. The whole exchange — headers AND body — must
 * finish within `timeoutMs`, else it throws GoogleTimeoutError: a hung request would otherwise
 * stall the poll cycle (and every later one, behind its re-entrancy guard) indefinitely.
 */
async function calendarFetch(
  timeoutMs: number,
  accessToken: string,
  url: string | URL,
  init: { method?: string; json?: unknown } = {},
  handled: number[] = [],
): Promise<CalendarResponse> {
  const hasBody = init.json !== undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  let body: string;
  try {
    res = await fetch(url, {
      ...(init.method ? { method: init.method } : {}),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(init.json) } : {}),
      signal,
    });
    body = await res.text();
  } catch (error) {
    if (signal.aborted) throw new GoogleTimeoutError(timeoutMs);
    throw error;
  }
  if (!res.ok && !handled.includes(res.status)) throw new GoogleApiError(res.status, body);
  return { status: res.status, json: <T>() => JSON.parse(body) as T };
}

async function writeEvent(
  timeoutMs: number,
  method: 'PUT' | 'PATCH',
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  event: GoogleEventWrite,
): Promise<void> {
  await calendarFetch(timeoutMs, accessToken, eventPath(calendarId, googleEventId), { method, json: toEventBody(event) });
}

/** Real GoogleClient backed by google-auth-library (OAuth) and fetch (Calendar REST). */
export function createGoogleClient(config: GoogleClientConfig): GoogleClient {
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  // The OAuth calls (refresh, code exchange, id-token certs) go through google-auth-library's
  // own transport, which honours `timeout`; a timed-out refresh surfaces as a plain (transient)
  // GoogleAuthError — it has no invalid_grant response, so it is never taken for a revocation.
  const oauth = (redirectUri?: string) =>
    new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri,
      transporterOptions: { timeout: timeoutMs },
    });
  const call = (accessToken: string, url: string | URL, init?: { method?: string; json?: unknown }, handled?: number[]) =>
    calendarFetch(timeoutMs, accessToken, url, init, handled);

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

      const res = await call(accessToken, url, {}, [410]);
      if (res.status === 410) throw new SyncTokenExpiredError();

      const data = res.json<{
        items?: RawGoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>();
      return {
        events: (data.items ?? []).map(mapEvent),
        nextPageToken: data.nextPageToken,
        nextSyncToken: data.nextSyncToken,
      };
    },

    async createCalendar(accessToken, summary) {
      const res = await call(accessToken, `${CALENDAR_API}/calendars`, { method: 'POST', json: { summary } });
      const data = res.json<{ id: string }>();
      return { calendarId: data.id };
    },

    async insertEvent(accessToken, calendarId, event: GoogleEventWrite) {
      const res = await call(accessToken, eventsPath(calendarId), { method: 'POST', json: toEventBody(event) });
      const data = res.json<{ id: string }>();
      return { googleEventId: data.id };
    },

    /** Full replace (PUT): only for events NotReclaim wholly owns, e.g. scheduled blocks. */
    updateEvent(accessToken, calendarId, googleEventId, event: GoogleEventWrite) {
      return writeEvent(timeoutMs, 'PUT', accessToken, calendarId, googleEventId, event);
    },

    /**
     * Merge (PATCH): leaves Google-side fields we never send — description, location,
     * attendees, reminders — intact. Use this for events the user can also edit in Google.
     */
    patchEvent(accessToken, calendarId, googleEventId, event: GoogleEventWrite) {
      return writeEvent(timeoutMs, 'PATCH', accessToken, calendarId, googleEventId, event);
    },

    async deleteEvent(accessToken, calendarId, googleEventId) {
      // Already gone (404/410) counts as deleted.
      await call(accessToken, eventPath(calendarId, googleEventId), { method: 'DELETE' }, [404, 410]);
    },
  };
}
