/** Tokens returned by an OAuth code exchange. */
export interface GoogleTokens {
  refreshToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
  googleUserId: string;
  email: string;
  emailVerified: boolean;
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
  timeMax?: string;
}

export interface ListEventsResult {
  events: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleEventWrite {
  summary: string;
  startDateTime: string; // RFC3339
  endDateTime: string;   // RFC3339
}

/** The seam everything mocks. */
export interface GoogleClient {
  getConsentUrl(redirectUri: string, state?: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens>;
  refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }>;
  listEvents(args: ListEventsArgs): Promise<ListEventsResult>;
  createCalendar(accessToken: string, summary: string): Promise<{ calendarId: string }>;
  insertEvent(accessToken: string, calendarId: string, event: GoogleEventWrite): Promise<{ googleEventId: string }>;
  updateEvent(accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void>;
  deleteEvent(accessToken: string, calendarId: string, googleEventId: string): Promise<void>;
}
