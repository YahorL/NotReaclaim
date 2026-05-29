import { OAuth2Client } from 'google-auth-library';
import type { GoogleClient, GoogleEvent, GoogleEventWrite, GoogleTokens, ListEventsArgs, ListEventsResult } from './client.js';
import { GoogleApiError, GoogleAuthError, SyncTokenExpiredError } from './errors.js';

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
}

function mapEvent(item: RawGoogleEvent): GoogleEvent {
  return {
    id: item.id,
    status: item.status ?? 'confirmed',
    summary: item.summary ?? null,
    start: item.start ?? null,
    end: item.end ?? null,
  };
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
        throw new GoogleAuthError(error instanceof Error ? error.message : 'Token refresh failed');
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

    async updateEvent(accessToken, calendarId, googleEventId, event: GoogleEventWrite) {
      const body = {
        summary: event.summary,
        start: { dateTime: event.startDateTime },
        end: { dateTime: event.endDateTime },
      };
      const res = await fetch(`${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new GoogleApiError(res.status, await res.text());
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
