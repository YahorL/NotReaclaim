import type { User } from '@notreclaim/db';
import type {
  GoogleClient,
  GoogleEventWrite,
  GoogleTokens,
  ListEventsArgs,
  ListEventsResult,
} from '../src/client.js';
import { SyncTokenExpiredError } from '../src/errors.js';

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'a@example.com',
    googleId: null,
    googleRefreshToken: null,
    autoScheduledCalendarId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

/** Scriptable fake Google client. */
export class FakeGoogleClient implements GoogleClient {
  consentUrl = 'https://consent.example/auth';
  exchangeResult: GoogleTokens = {
    refreshToken: 'refresh-1',
    accessToken: 'access-initial',
    expiresAt: 0,
    googleUserId: 'g-123',
    email: 'a@example.com',
  };
  refreshResponses: Array<{ accessToken: string; expiresAt: number }> = [];
  listQueue: Array<ListEventsResult | 'GONE'> = [];
  refreshCalls = 0;
  exchangeCalls = 0;
  listCalls: ListEventsArgs[] = [];

  getConsentUrl(): string {
    return this.consentUrl;
  }

  async exchangeCode(): Promise<GoogleTokens> {
    this.exchangeCalls += 1;
    return this.exchangeResult;
  }

  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: number }> {
    this.refreshCalls += 1;
    return this.refreshResponses.shift() ?? { accessToken: 'access-refreshed', expiresAt: 0 };
  }

  async listEvents(args: ListEventsArgs): Promise<ListEventsResult> {
    this.listCalls.push(args);
    const next = this.listQueue.shift();
    if (next === undefined) return { events: [] };
    if (next === 'GONE') throw new SyncTokenExpiredError();
    return next;
  }

  createdCalendars: string[] = [];
  createCalendarResult = { calendarId: 'cal-auto' };
  insertedEvents: Array<{ calendarId: string; event: GoogleEventWrite }> = [];
  updatedEvents: Array<{ calendarId: string; googleEventId: string; event: GoogleEventWrite }> = [];
  deletedEvents: Array<{ calendarId: string; googleEventId: string }> = [];
  private insertCount = 0;

  async createCalendar(_accessToken: string, summary: string): Promise<{ calendarId: string }> {
    this.createdCalendars.push(summary);
    return this.createCalendarResult;
  }

  async insertEvent(_accessToken: string, calendarId: string, event: GoogleEventWrite): Promise<{ googleEventId: string }> {
    this.insertCount += 1;
    this.insertedEvents.push({ calendarId, event });
    return { googleEventId: `g-evt-${this.insertCount}` };
  }

  async updateEvent(_accessToken: string, calendarId: string, googleEventId: string, event: GoogleEventWrite): Promise<void> {
    this.updatedEvents.push({ calendarId, googleEventId, event });
  }

  async deleteEvent(_accessToken: string, calendarId: string, googleEventId: string): Promise<void> {
    this.deletedEvents.push({ calendarId, googleEventId });
  }
}

/** In-memory UserRepository fake (the subset the token service uses). */
export function fakeUserRepo(seed: User[] = []) {
  const usersById = new Map<string, User>(seed.map((u) => [u.id, u]));
  let counter = seed.length;
  return {
    async findById(id: string): Promise<User | null> {
      return usersById.get(id) ?? null;
    },
    async findByGoogleId(googleId: string): Promise<User | null> {
      return [...usersById.values()].find((u) => u.googleId === googleId) ?? null;
    },
    async create(data: { email: string; googleId?: string | null }): Promise<User> {
      counter += 1;
      const user = makeUser({ id: `u${counter}`, email: data.email, googleId: data.googleId ?? null });
      usersById.set(user.id, user);
      return user;
    },
    async update(id: string, data: Partial<User>): Promise<User> {
      const existing = usersById.get(id);
      if (!existing) throw new Error(`user ${id} not found`);
      const updated = { ...existing, ...data };
      usersById.set(id, updated);
      return updated;
    },
  };
}

import type { CalendarSyncState, UpsertSyncStateInput, UpsertCalendarEventInput } from '@notreclaim/db';

export function makeSyncState(over: Partial<CalendarSyncState> = {}): CalendarSyncState {
  return {
    id: 'ss1',
    userId: 'u1',
    googleCalendarId: 'primary',
    syncToken: null,
    lastSyncedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

export function fakeSyncStateRepo(initial: CalendarSyncState | null = null) {
  let state = initial;
  const upserts: UpsertSyncStateInput[] = [];
  return {
    async getByCalendar(): Promise<CalendarSyncState | null> {
      return state;
    },
    async upsert(userId: string, googleCalendarId: string, data: UpsertSyncStateInput): Promise<CalendarSyncState> {
      upserts.push(data);
      state = makeSyncState({ userId, googleCalendarId, syncToken: data.syncToken ?? null, lastSyncedAt: data.lastSyncedAt ?? null });
      return state;
    },
    upserts,
  };
}

export function fakeEventsRepo() {
  const upserted: UpsertCalendarEventInput[][] = [];
  const deleted: string[][] = [];
  const clearedCalendars: string[] = [];
  return {
    async upsertMany(_userId: string, events: UpsertCalendarEventInput[]): Promise<void> {
      upserted.push(events);
    },
    async deleteByGoogleEventIds(_userId: string, ids: string[]): Promise<void> {
      deleted.push(ids);
    },
    async deleteByCalendar(_userId: string, googleCalendarId: string): Promise<void> {
      clearedCalendars.push(googleCalendarId);
    },
    upserted,
    deleted,
    clearedCalendars,
  };
}

/** Minimal access-token provider for sync tests. */
export function fakeTokenProvider(token = 'access-token') {
  return { async getAccessToken(): Promise<string> { return token; } };
}
