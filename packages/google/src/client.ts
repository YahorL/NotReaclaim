/** Tokens returned by an OAuth code exchange. */
export interface GoogleTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  googleUserId: string;
  email: string;
}

export interface GoogleEventTime {
  dateTime?: string; // RFC3339, for timed events
  date?: string; // YYYY-MM-DD, for all-day events
}

export interface GoogleEvent {
  id: string;
  status: string; // 'confirmed' | 'tentative' | 'cancelled'
  summary: string | null;
  start: GoogleEventTime | null;
  end: GoogleEventTime | null;
}

export interface ListEventsArgs {
  accessToken: string;
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  timeMin?: string; // RFC3339, used only on the initial full sync
}

export interface ListEventsResult {
  events: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** The seam everything mocks. */
export interface GoogleClient {
  getConsentUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  listEvents(args: ListEventsArgs): Promise<ListEventsResult>;
}
