# NotReclaim Web Client Foundation Implementation Plan (Milestone 5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runnable foundation of the NotReclaim web client — a Vite + React + TypeScript + Tailwind app with a typed API client, Google sign-in (redirect-with-token), an app shell with protected routing, and a WebSocket hook that invalidates TanStack Query caches on server events.

**Architecture:** A new `packages/web` SPA consumes the `@notreclaim/server` REST API + `/ws` WebSocket. Dependency injection (an injected `ApiClient` via React context, an injected WebSocket factory) keeps everything unit-testable with fakes — no real network or Google. One small backward-compatible server change makes the OAuth callback redirect the browser back to the SPA with the JWT in the URL fragment.

**Tech Stack:** React 18, Vite 5, TypeScript (strict, bundler resolution), Tailwind v3, `@tanstack/react-query` v5, `react-router-dom` v6; Vitest + `@testing-library/react` + jsdom.

**Spec:** `docs/superpowers/specs/2026-05-29-notreclaim-web-foundation-design.md`

**Convention note:** Unlike the backend packages (which use explicit `.js` import extensions for Node ESM), `packages/web` uses **extensionless imports** — the idiomatic Vite/React style, resolved by both Vite and `tsc` under `moduleResolution: "Bundler"`. Do not add `.js` extensions to imports in `packages/web`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/server/src/config.ts` (modify) | add optional `webClientUrl` (`WEB_CLIENT_URL`) |
| `packages/server/src/app.ts` (modify) | add `webClientUrl?` to `AppDeps.config` |
| `packages/server/src/auth-routes.ts` (modify) | callback 302-redirects to the SPA when `webClientUrl` set |
| `packages/server/test/fakes.ts` (modify) | `buildTestApp` accepts `webClientUrl` override |
| `packages/server/test/{auth,config}.test.ts` (modify) | redirect + config tests |
| `packages/web/package.json` etc. (create) | scaffold: Vite/React/TS/Tailwind/Vitest toolchain |
| `packages/web/src/api/types.ts` (create) | client-side DTOs |
| `packages/web/src/api/client.ts` (create) | `ApiClient`, `createApiClient`, `ApiError` |
| `packages/web/src/api/ApiProvider.tsx` (create) | React context + `useApi()` |
| `packages/web/src/auth/tokenStore.ts` (create) | localStorage token persistence |
| `packages/web/src/auth/AuthContext.tsx` (create) | token/userId state + `setAuth`/`signOut` |
| `packages/web/src/auth/SignIn.tsx` (create) | "Sign in with Google" |
| `packages/web/src/auth/AuthCallback.tsx` (create) | capture token from URL fragment |
| `packages/web/src/app/ProtectedRoute.tsx` (create) | gate protected routes |
| `packages/web/src/app/{Sidebar,AppShell}.tsx` (create) | shell chrome |
| `packages/web/src/app/pages/*.tsx` (create) | placeholder pages |
| `packages/web/src/app/App.tsx` (create) | route table |
| `packages/web/src/realtime/events.ts` (create) | `ServerEvent` + `invalidateForEvent` |
| `packages/web/src/realtime/useWebSocket.ts` (create) | WS hook (injectable socket factory) |
| `packages/web/src/main.tsx` (create) | compose providers |
| `packages/web/src/test/{setup,fakes}.ts(x)` (create) | jest-dom + `renderWithProviders`, `FakeApiClient`, `FakeWebSocket` |

---

## Task 1: Server — `WEB_CLIENT_URL` + callback redirect

**Files:**
- Modify: `packages/server/src/config.ts`, `packages/server/src/app.ts`, `packages/server/src/auth-routes.ts`, `packages/server/test/fakes.ts`
- Test: `packages/server/test/auth.test.ts`, `packages/server/test/config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/test/config.test.ts`, add inside `describe('loadServerConfig', ...)`:

```ts
  it('reads WEB_CLIENT_URL when set and defaults it to undefined', () => {
    expect(loadServerConfig({ JWT_SECRET: 's' } as NodeJS.ProcessEnv).webClientUrl).toBeUndefined();
    const cfg = loadServerConfig({ JWT_SECRET: 's', WEB_CLIENT_URL: 'http://localhost:5173' } as NodeJS.ProcessEnv);
    expect(cfg.webClientUrl).toBe('http://localhost:5173');
  });
```

In `packages/server/test/auth.test.ts`, add inside `describe('auth', ...)`:

```ts
  it('callback redirects to the web client with token in the fragment when WEB_CLIENT_URL is set', async () => {
    const { app } = buildTestApp({ webClientUrl: 'http://localhost:5173' });
    const res = await app.inject({ method: 'GET', url: '/auth/google/callback?code=abc' });
    expect(res.statusCode).toBe(302);
    const loc = res.headers.location as string;
    expect(loc.startsWith('http://localhost:5173/auth/callback#')).toBe(true);
    expect(loc).toContain('userId=u1');
    expect(loc).toContain('token=');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/server -- auth config`
Expected: FAIL — `webClientUrl` undefined on the type / callback returns 200 JSON, not 302. (The `buildTestApp({ webClientUrl })` option does not exist yet — a TypeScript error is also an acceptable "fail".)

- [ ] **Step 3: Add `webClientUrl` to config**

In `packages/server/src/config.ts`, add the field and read it:

```ts
export interface ServerConfig {
  port: number;
  jwtSecret: string;
  pollIntervalMs: number;
  webClientUrl?: string;
}
```

And in `loadServerConfig`, before the `return`:

```ts
  const webClientUrl = env.WEB_CLIENT_URL || undefined;
```

Then change the return to:

```ts
  return { port, jwtSecret, pollIntervalMs, webClientUrl };
```

- [ ] **Step 4: Thread `webClientUrl` through `AppDeps.config`**

In `packages/server/src/app.ts`, change the `config` field of `AppDeps`:

```ts
  config: { jwtSecret: string; googleRedirectUri: string; webClientUrl?: string };
```

- [ ] **Step 5: Redirect in the callback**

Replace the callback handler in `packages/server/src/auth-routes.ts` with:

```ts
  app.get('/auth/google/callback', async (request, reply) => {
    const { code } = authCallbackQuerySchema.parse(request.query);
    const user = await deps.google.tokens.connectFromCode(code, deps.config.googleRedirectUri);
    const token = app.jwt.sign({ sub: user.id });
    if (deps.config.webClientUrl) {
      const fragment = `token=${encodeURIComponent(token)}&userId=${encodeURIComponent(user.id)}`;
      return reply.redirect(302, `${deps.config.webClientUrl}/auth/callback#${fragment}`);
    }
    return { token, userId: user.id };
  });
```

- [ ] **Step 6: Let `buildTestApp` set `webClientUrl`**

In `packages/server/test/fakes.ts`, add `webClientUrl?: string;` to the `TestAppOptions` interface, and in the `buildApp({ ... })` call change the `config` line to:

```ts
    config: { jwtSecret: 'test-secret', googleRedirectUri: 'http://localhost:3000/auth/google/callback', webClientUrl: opts.webClientUrl },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/server`
Expected: PASS — all server tests green, including the new redirect (302 with fragment) and the unchanged JSON path (the existing "callback exchanges a code for a JWT" test still gets `{token,userId}` because no `webClientUrl` is set there).

- [ ] **Step 8: Typecheck + commit**

Run: `npm run build -w @notreclaim/server` (clean)
```bash
git add packages/server/src/config.ts packages/server/src/app.ts packages/server/src/auth-routes.ts packages/server/test/fakes.ts packages/server/test/auth.test.ts packages/server/test/config.test.ts
git commit -m "feat(server): WEB_CLIENT_URL — redirect OAuth callback to the SPA with token"
```

---

## Task 2: Scaffold `packages/web`

**Files:** Create the package, toolchain config, entry files, and a smoke test.

- [ ] **Step 1: Create `packages/web/package.json`**

```json
{
  "name": "@notreclaim/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2",
    "@tanstack/react-query": "^5.59.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "vite": "^5.4.8",
    "typescript": "^5.4.0",
    "tailwindcss": "^3.4.13",
    "postcss": "^8.4.47",
    "autoprefixer": "^10.4.20",
    "vitest": "^1.6.0",
    "jsdom": "^24.1.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.5.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run (from repo root): `npm install`
Expected: installs `@notreclaim/web` deps into the workspace; no peer-dependency errors. (`@testing-library/react@16` needs `@testing-library/dom` as a peer — it is included above.)

- [ ] **Step 3: Create the toolchain config files**

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node", "vite/client"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`packages/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': API,
      '/tasks': API,
      '/habits': API,
      '/settings': API,
      '/schedule': API,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

`packages/web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`packages/web/tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`packages/web/postcss.config.js`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NotReclaim</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Create the test setup + a smoke component + smoke test**

`packages/web/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`packages/web/src/app/App.tsx` (temporary minimal version — replaced in Task 7):
```tsx
export function App() {
  return <div>NotReclaim</div>;
}
```

`packages/web/src/main.tsx` (temporary minimal version — replaced in Task 9):
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`packages/web/src/app/App.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App (smoke)', () => {
  it('renders the app name', () => {
    render(<App />);
    expect(screen.getByText('NotReclaim')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Verify the toolchain (typecheck, build, test)**

Run: `npm test -w @notreclaim/web`
Expected: PASS (1 test).
Run: `npm run build -w @notreclaim/web`
Expected: `tsc` clean and `vite build` produces `dist/` with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/web package-lock.json
git commit -m "feat(web): scaffold @notreclaim/web (Vite + React + TS + Tailwind + Vitest)"
```

---

## Task 3: API client + DTO types

**Files:**
- Create: `packages/web/src/api/types.ts`, `packages/web/src/api/client.ts`
- Test: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/web/src/api/client.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createApiClient, ApiError } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => vi.unstubAllGlobals());

describe('createApiClient', () => {
  it('attaches a bearer token and parses JSON', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ id: 't1' }]));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 'jwt-123' });

    const tasks = await api.listTasks();

    expect(tasks).toEqual([{ id: 't1' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/tasks');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-123' });
  });

  it('omits the Authorization header when there is no token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ url: 'https://consent' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => null });

    await api.getConsentUrl();

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('maps a non-2xx {code,message} body to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ code: 'not_found', message: 'Task x not found' }, 404)));
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await expect(api.deleteTask('x')).rejects.toMatchObject({ name: 'ApiError', status: 404, code: 'not_found' });
    expect(await api.getSettings().catch((e) => e)).toBeInstanceOf(ApiError);
  });

  it('sends a JSON body with Content-Type on writes', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 't1', title: 'A' }));
    vi.stubGlobal('fetch', fetchMock);
    const api = createApiClient({ baseUrl: '', getToken: () => 't' });

    await api.createTask({ title: 'A', priority: 1, durationMs: 1, dueBy: '2026-01-01T00:00:00.000Z', minChunkMs: 1, maxChunkMs: 1 });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toMatchObject({ title: 'A' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @notreclaim/web -- client`
Expected: FAIL — cannot find module `./client`.

- [ ] **Step 3: Create `packages/web/src/api/types.ts`**

```ts
export type TaskStatus = 'pending' | 'scheduled' | 'completed' | 'archived';
export type HabitStatus = 'active' | 'paused';

export interface Task {
  id: string;
  userId: string;
  title: string;
  priority: number;
  durationMs: number;
  dueBy: string;
  minChunkMs: number;
  maxChunkMs: number;
  category: string | null;
  status: TaskStatus;
  timeLoggedMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface Habit {
  id: string;
  userId: string;
  title: string;
  priority: number;
  chunkMs: number;
  perPeriod: number;
  periodType: 'week';
  preferredStartMinute: number | null;
  preferredEndMinute: number | null;
  eligibleDays: number[];
  status: HabitStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingHour {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Settings {
  id: string;
  userId: string;
  timezone: string;
  workingHours: WorkingHour[];
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledBlock {
  id: string;
  userId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  taskId: string | null;
  habitId: string | null;
  pinned: boolean;
  engineKey: string | null;
}

export interface UnscheduledItem {
  sourceType: 'task' | 'habit';
  sourceId: string;
  title: string;
  reason: string;
}

export interface SchedulePreview {
  blocks: ScheduledBlock[];
  unscheduled: UnscheduledItem[];
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  pinned: number;
  removed: number;
}

export interface CreateTaskInput {
  title: string;
  priority: number;
  durationMs: number;
  dueBy: string;
  minChunkMs: number;
  maxChunkMs: number;
  category?: string | null;
}
export type UpdateTaskInput = Partial<CreateTaskInput> & { status?: TaskStatus; timeLoggedMs?: number };

export interface CreateHabitInput {
  title: string;
  priority: number;
  chunkMs: number;
  perPeriod: number;
  eligibleDays: number[];
  periodType?: 'week';
  preferredStartMinute?: number | null;
  preferredEndMinute?: number | null;
}
export type UpdateHabitInput = Partial<CreateHabitInput> & { status?: HabitStatus };

export interface SettingsInput {
  timezone: string;
  workingHours: WorkingHour[];
  horizonDays?: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
}
```

- [ ] **Step 4: Create `packages/web/src/api/client.ts`**

```ts
import type {
  Task, Habit, Settings, ScheduledBlock, SchedulePreview, ReconcileResult,
  TaskStatus, CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput,
} from './types';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
}

export interface ApiClient {
  getConsentUrl(): Promise<{ url: string }>;
  listTasks(status?: TaskStatus): Promise<Task[]>;
  createTask(body: CreateTaskInput): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  deleteTask(id: string): Promise<void>;
  listHabits(): Promise<Habit[]>;
  createHabit(body: CreateHabitInput): Promise<Habit>;
  updateHabit(id: string, patch: UpdateHabitInput): Promise<Habit>;
  deleteHabit(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  putSettings(body: SettingsInput): Promise<Settings>;
  getSchedule(from?: string, to?: string): Promise<ScheduledBlock[]>;
  getSchedulePreview(): Promise<SchedulePreview>;
  replan(): Promise<ReconcileResult>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    const token = config.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let code = 'error';
      let message = `Request failed with status ${res.status}`;
      try {
        const parsed = (await res.json()) as { code?: string; message?: string };
        if (parsed.code) code = parsed.code;
        if (parsed.message) message = parsed.message;
      } catch {
        // non-JSON error body; keep the defaults
      }
      throw new ApiError(res.status, code, message);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    getConsentUrl: () => request('GET', '/auth/google'),
    listTasks: (status) => request('GET', `/tasks${status ? `?status=${status}` : ''}`),
    createTask: (body) => request('POST', '/tasks', body),
    updateTask: (id, patch) => request('PATCH', `/tasks/${id}`, patch),
    deleteTask: (id) => request('DELETE', `/tasks/${id}`),
    listHabits: () => request('GET', '/habits'),
    createHabit: (body) => request('POST', '/habits', body),
    updateHabit: (id, patch) => request('PATCH', `/habits/${id}`, patch),
    deleteHabit: (id) => request('DELETE', `/habits/${id}`),
    getSettings: () => request('GET', '/settings'),
    putSettings: (body) => request('PUT', '/settings', body),
    getSchedule: (from, to) => {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      return request('GET', `/schedule${qs ? `?${qs}` : ''}`);
    },
    getSchedulePreview: () => request('GET', '/schedule/preview'),
    replan: () => request('POST', '/schedule/replan'),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- client`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/types.ts packages/web/src/api/client.ts packages/web/src/api/client.test.ts
git commit -m "feat(web): typed API client + DTOs with bearer auth and ApiError mapping"
```

---

## Task 4: `ApiProvider` / `useApi`

**Files:**
- Create: `packages/web/src/api/ApiProvider.tsx`
- Test: `packages/web/src/api/ApiProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

`packages/web/src/api/ApiProvider.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiProvider, useApi } from './ApiProvider';
import type { ApiClient } from './client';

const stub = { getConsentUrl: async () => ({ url: 'u' }) } as unknown as ApiClient;

function Probe() {
  const api = useApi();
  return <div>{typeof api.getConsentUrl}</div>;
}

describe('useApi', () => {
  it('returns the client provided by ApiProvider', () => {
    render(
      <ApiProvider client={stub}>
        <Probe />
      </ApiProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
  });

  it('throws when used outside an ApiProvider', () => {
    expect(() => render(<Probe />)).toThrow(/ApiProvider/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @notreclaim/web -- ApiProvider`
Expected: FAIL — cannot find module `./ApiProvider`.

- [ ] **Step 3: Create `packages/web/src/api/ApiProvider.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={client}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi must be used within an ApiProvider');
  return client;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @notreclaim/web -- ApiProvider`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/ApiProvider.tsx packages/web/src/api/ApiProvider.test.tsx
git commit -m "feat(web): ApiProvider context + useApi hook"
```

---

## Task 5: `tokenStore` + `AuthContext`

**Files:**
- Create: `packages/web/src/auth/tokenStore.ts`, `packages/web/src/auth/AuthContext.tsx`
- Test: `packages/web/src/auth/tokenStore.test.ts`, `packages/web/src/auth/AuthContext.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/auth/tokenStore.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

describe('tokenStore', () => {
  it('returns null when empty and round-trips a stored value', () => {
    expect(tokenStore.get()).toBeNull();
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
  });

  it('clears the stored value', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    tokenStore.clear();
    expect(tokenStore.get()).toBeNull();
  });

  it('returns null for a corrupt value', () => {
    localStorage.setItem('notreclaim.auth', '{not json');
    expect(tokenStore.get()).toBeNull();
  });
});
```

`packages/web/src/auth/AuthContext.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

function Probe() {
  const { token, setAuth, signOut } = useAuth();
  return (
    <div>
      <span data-testid="token">{token ?? 'none'}</span>
      <button onClick={() => setAuth({ token: 'jwt', userId: 'u1' })}>in</button>
      <button onClick={signOut}>out</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('hydrates from tokenStore, persists setAuth, and clears on signOut', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByTestId('token').textContent).toBe('none');

    fireEvent.click(screen.getByText('in'));
    expect(screen.getByTestId('token').textContent).toBe('jwt');
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });

    fireEvent.click(screen.getByText('out'));
    expect(screen.getByTestId('token').textContent).toBe('none');
    expect(tokenStore.get()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/web -- tokenStore AuthContext`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `packages/web/src/auth/tokenStore.ts`**

```ts
const KEY = 'notreclaim.auth';

export interface StoredAuth {
  token: string;
  userId: string;
}

export const tokenStore = {
  get(): StoredAuth | null {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      return null;
    }
  },
  set(auth: StoredAuth): void {
    localStorage.setItem(KEY, JSON.stringify(auth));
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
```

- [ ] **Step 4: Create `packages/web/src/auth/AuthContext.tsx`**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { tokenStore, type StoredAuth } from './tokenStore';

interface AuthValue {
  token: string | null;
  userId: string | null;
  setAuth: (auth: StoredAuth) => void;
  signOut: () => void;
}

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuthState] = useState<StoredAuth | null>(() => tokenStore.get());

  const setAuth = useCallback((next: StoredAuth) => {
    tokenStore.set(next);
    setAuthState(next);
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setAuthState(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token: auth?.token ?? null, userId: auth?.userId ?? null, setAuth, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/web -- tokenStore AuthContext`
Expected: PASS (4 tests total).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/auth/tokenStore.ts packages/web/src/auth/AuthContext.tsx packages/web/src/auth/tokenStore.test.ts packages/web/src/auth/AuthContext.test.tsx
git commit -m "feat(web): tokenStore + AuthContext"
```

---

## Task 6: `SignIn` + `AuthCallback` + test harness

**Files:**
- Create: `packages/web/src/test/fakes.tsx`, `packages/web/src/auth/SignIn.tsx`, `packages/web/src/auth/AuthCallback.tsx`
- Test: `packages/web/src/auth/SignIn.test.tsx`, `packages/web/src/auth/AuthCallback.test.tsx`

- [ ] **Step 1: Create the shared test harness `packages/web/src/test/fakes.tsx`**

```tsx
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../api/ApiProvider';
import { AuthProvider } from '../auth/AuthContext';
import type { ApiClient } from '../api/client';

export function fakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notImplemented = (name: string) => () => Promise.reject(new Error(`${name} not implemented in fake`));
  const base: ApiClient = {
    getConsentUrl: notImplemented('getConsentUrl'),
    listTasks: notImplemented('listTasks'),
    createTask: notImplemented('createTask'),
    updateTask: notImplemented('updateTask'),
    deleteTask: notImplemented('deleteTask'),
    listHabits: notImplemented('listHabits'),
    createHabit: notImplemented('createHabit'),
    updateHabit: notImplemented('updateHabit'),
    deleteHabit: notImplemented('deleteHabit'),
    getSettings: notImplemented('getSettings'),
    putSettings: notImplemented('putSettings'),
    getSchedule: notImplemented('getSchedule'),
    getSchedulePreview: notImplemented('getSchedulePreview'),
    replan: notImplemented('replan'),
  } as unknown as ApiClient;
  return { ...base, ...overrides };
}

export function renderWithProviders(
  ui: ReactElement,
  opts: { api?: ApiClient; initialEntries?: string[] } = {},
): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = opts.api ?? fakeApiClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={opts.initialEntries ?? ['/']}>
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
```

- [ ] **Step 2: Write the failing tests**

`packages/web/src/auth/SignIn.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SignIn } from './SignIn';
import { renderWithProviders, fakeApiClient } from '../test/fakes';

beforeEach(() => localStorage.clear());

describe('SignIn', () => {
  it('redirects to the Google consent URL on click', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const api = fakeApiClient({ getConsentUrl: async () => ({ url: 'https://accounts.google/consent' }) });

    renderWithProviders(<SignIn />, { api });
    fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google/consent'));
  });
});
```

`packages/web/src/auth/AuthCallback.test.tsx`:
```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { AuthCallback } from './AuthCallback';
import { renderWithProviders } from '../test/fakes';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

function Harness() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={<div>home</div>} />
      <Route path="/signin" element={<div>signin</div>} />
    </Routes>
  );
}

describe('AuthCallback', () => {
  it('stores the token from the fragment and navigates home', async () => {
    renderWithProviders(<Harness />, { initialEntries: ['/auth/callback#token=jwt&userId=u1'] });
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
  });

  it('redirects to signin when the fragment has no token', async () => {
    renderWithProviders(<Harness />, { initialEntries: ['/auth/callback#oops'] });
    expect(await screen.findByText('signin')).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/web -- SignIn AuthCallback`
Expected: FAIL — `SignIn`/`AuthCallback` modules not found.

- [ ] **Step 4: Create `packages/web/src/auth/SignIn.tsx`**

```tsx
import { useApi } from '../api/ApiProvider';

export function SignIn() {
  const api = useApi();
  const onSignIn = async () => {
    const { url } = await api.getConsentUrl();
    window.location.assign(url);
  };
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">NotReclaim</h1>
      <p className="text-gray-500">Your calendar, auto-scheduled.</p>
      <button onClick={onSignIn} className="rounded bg-blue-600 px-4 py-2 text-white">
        Sign in with Google
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Create `packages/web/src/auth/AuthCallback.tsx`**

```tsx
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function AuthCallback() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const token = params.get('token');
    const userId = params.get('userId');
    if (token && userId) {
      setAuth({ token, userId });
      navigate('/', { replace: true });
    } else {
      navigate('/signin', { replace: true });
    }
  }, [hash, navigate, setAuth]);

  return <p className="p-8 text-gray-500">Signing you in…</p>;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/web -- SignIn AuthCallback`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/test/fakes.tsx packages/web/src/auth/SignIn.tsx packages/web/src/auth/AuthCallback.tsx packages/web/src/auth/SignIn.test.tsx packages/web/src/auth/AuthCallback.test.tsx
git commit -m "feat(web): Google sign-in + auth callback (redirect-with-token)"
```

---

## Task 7: App shell + routing

**Files:**
- Create: `packages/web/src/app/ProtectedRoute.tsx`, `packages/web/src/app/Sidebar.tsx`, `packages/web/src/app/AppShell.tsx`, `packages/web/src/app/pages/{Planner,Tasks,Habits,Settings}.tsx`
- Modify: `packages/web/src/app/App.tsx` (replace the Task 2 placeholder), `packages/web/src/app/App.test.tsx` (replace the smoke test)
- Test: `packages/web/src/app/App.test.tsx`

- [ ] **Step 1: Create the placeholder pages**

`packages/web/src/app/pages/Planner.tsx`:
```tsx
export function Planner() {
  return <div className="p-6"><h2 className="text-lg font-semibold">Planner</h2><p className="text-gray-500">Week view — arrives in 5b.</p></div>;
}
```
`packages/web/src/app/pages/Tasks.tsx`:
```tsx
export function Tasks() {
  return <div className="p-6"><h2 className="text-lg font-semibold">Tasks</h2><p className="text-gray-500">Task list — arrives in 5c.</p></div>;
}
```
`packages/web/src/app/pages/Habits.tsx`:
```tsx
export function Habits() {
  return <div className="p-6"><h2 className="text-lg font-semibold">Habits</h2><p className="text-gray-500">Habit list — arrives in 5c.</p></div>;
}
```
`packages/web/src/app/pages/Settings.tsx`:
```tsx
export function Settings() {
  return <div className="p-6"><h2 className="text-lg font-semibold">Settings</h2><p className="text-gray-500">Settings — arrives in 5d.</p></div>;
}
```

- [ ] **Step 2: Create `packages/web/src/app/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function ProtectedRoute() {
  const { token } = useAuth();
  return token ? <Outlet /> : <Navigate to="/signin" replace />;
}
```

- [ ] **Step 3: Create `packages/web/src/app/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const links = [
  { to: '/', label: 'Planner', end: true },
  { to: '/tasks', label: 'Tasks', end: false },
  { to: '/habits', label: 'Habits', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export function Sidebar() {
  const { signOut } = useAuth();
  return (
    <nav className="flex w-48 flex-col gap-1 border-r border-gray-200 p-3">
      <div className="mb-3 font-semibold">NotReclaim</div>
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => `rounded px-2 py-1 ${isActive ? 'bg-blue-100 font-medium' : 'text-gray-700'}`}
        >
          {l.label}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col gap-2 pt-3 text-sm text-gray-500">
        <span>◉ Connected</span>
        <button onClick={signOut} className="text-left text-gray-700 hover:underline">Sign out</button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Create `packages/web/src/app/AppShell.tsx`**

```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Replace `packages/web/src/app/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { SignIn } from '../auth/SignIn';
import { AuthCallback } from '../auth/AuthCallback';
import { ProtectedRoute } from './ProtectedRoute';
import { AppShell } from './AppShell';
import { Planner } from './pages/Planner';
import { Tasks } from './pages/Tasks';
import { Habits } from './pages/Habits';
import { Settings } from './pages/Settings';

export function App() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<Planner />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/habits" element={<Habits />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 6: Replace `packages/web/src/app/App.test.tsx`**

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders } from '../test/fakes';
import { tokenStore } from '../auth/tokenStore';

beforeEach(() => localStorage.clear());

describe('App routing', () => {
  it('redirects to /signin when unauthenticated', () => {
    renderWithProviders(<App />, { initialEntries: ['/'] });
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('renders the shell with nav links when authenticated', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    expect(screen.getByText('Planner')).toBeInTheDocument();
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('Habits')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByText('Habits'));
    expect(screen.getByText(/arrives in 5c/i)).toBeInTheDocument();
  });

  it('signs out back to /signin', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/web -- App`
Expected: PASS (4 tests). (Note: `renderWithProviders` already supplies a `MemoryRouter`, so `App`'s `Routes` mount inside it.)

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/app
git commit -m "feat(web): app shell, sidebar, protected routing, placeholder pages"
```

---

## Task 8: `useWebSocket` + event-driven query invalidation

**Files:**
- Create: `packages/web/src/realtime/events.ts`, `packages/web/src/realtime/useWebSocket.ts`
- Test: `packages/web/src/realtime/events.test.ts`, `packages/web/src/realtime/useWebSocket.test.tsx`

- [ ] **Step 1: Write the failing tests**

`packages/web/src/realtime/events.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { invalidateForEvent } from './events';

function spyClient() {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
  return { qc, spy };
}

describe('invalidateForEvent', () => {
  it('schedule.updated invalidates the schedule queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'schedule.updated', userId: 'u1', counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('sync.completed invalidates the schedule queries', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'sync.completed', userId: 'u1', sync: {}, counts: {} });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('task.changed invalidates both tasks and schedule', () => {
    const { qc, spy } = spyClient();
    invalidateForEvent(qc, { type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});
```

`packages/web/src/realtime/useWebSocket.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWebSocket, type SocketLike } from './useWebSocket';

class FakeSocket implements SocketLike {
  listeners: Record<string, ((ev: unknown) => void)[]> = {};
  closed = false;
  addEventListener(type: string, fn: (ev: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev: unknown) {
    (this.listeners[type] ?? []).forEach((fn) => fn(ev));
  }
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useWebSocket', () => {
  it('invalidates query keys when a server event arrives', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const socket = new FakeSocket();

    renderHook(() => useWebSocket({ token: 'jwt', makeSocket: () => socket }), { wrapper: wrapper(qc) });
    socket.emit('message', { data: JSON.stringify({ type: 'task.changed', userId: 'u1', taskId: 't1', action: 'created' }) });

    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });

  it('does not connect without a token', () => {
    const qc = new QueryClient();
    const makeSocket = vi.fn(() => new FakeSocket());
    renderHook(() => useWebSocket({ token: null, makeSocket }), { wrapper: wrapper(qc) });
    expect(makeSocket).not.toHaveBeenCalled();
  });

  it('reconnects after an unexpected close', () => {
    const qc = new QueryClient();
    const sockets: FakeSocket[] = [];
    const makeSocket = vi.fn(() => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    });
    renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    expect(makeSocket).toHaveBeenCalledTimes(1);

    sockets[0]!.emit('close', {});
    vi.advanceTimersByTime(2000);
    expect(makeSocket).toHaveBeenCalledTimes(2);
  });

  it('closes the socket on unmount without reconnecting', () => {
    const qc = new QueryClient();
    const makeSocket = vi.fn(() => new FakeSocket());
    const { unmount } = renderHook(() => useWebSocket({ token: 'jwt', makeSocket }), { wrapper: wrapper(qc) });
    unmount();
    vi.advanceTimersByTime(5000);
    expect(makeSocket).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @notreclaim/web -- events useWebSocket`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `packages/web/src/realtime/events.ts`**

```ts
import type { QueryClient } from '@tanstack/react-query';

export type ServerEvent =
  | { type: 'schedule.updated'; userId: string; counts: unknown }
  | { type: 'sync.completed'; userId: string; sync: unknown; counts: unknown }
  | { type: 'task.changed'; userId: string; taskId: string; action: 'created' | 'updated' | 'deleted' };

/** Invalidate the query keys affected by a server event. Invalidating ['schedule'] matches
 *  every ['schedule', ...] key (including ['schedule','preview']) by prefix. */
export function invalidateForEvent(qc: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case 'schedule.updated':
    case 'sync.completed':
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      break;
    case 'task.changed':
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['schedule'] });
      break;
  }
}
```

- [ ] **Step 4: Create `packages/web/src/realtime/useWebSocket.ts`**

```ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateForEvent, type ServerEvent } from './events';

export interface SocketLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  close(): void;
}

export interface UseWebSocketOptions {
  token: string | null;
  baseUrl?: string;
  makeSocket?: (url: string) => SocketLike;
}

const RECONNECT_MS = 2000;

function defaultUrl(baseUrl: string): string {
  if (baseUrl) return `${baseUrl.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket({ token, baseUrl = '', makeSocket = (url) => new WebSocket(url) }: UseWebSocketOptions): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    let intentionallyClosed = false;
    let socket: SocketLike;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const url = `${defaultUrl(baseUrl)}?token=${encodeURIComponent(token)}`;
      socket = makeSocket(url);
      socket.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data as string) as ServerEvent;
          invalidateForEvent(qc, event);
        } catch {
          // ignore non-JSON frames
        }
      });
      socket.addEventListener('close', () => {
        if (!intentionallyClosed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
      });
    };

    connect();

    return () => {
      intentionallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket.close();
    };
  }, [token, baseUrl, makeSocket, qc]);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -w @notreclaim/web -- events useWebSocket`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/realtime
git commit -m "feat(web): useWebSocket hook with event-driven query invalidation"
```

---

## Task 9: Compose providers in `main.tsx` + mount the WS hook + final verification

**Files:**
- Modify: `packages/web/src/main.tsx` (replace the Task 2 placeholder), `packages/web/src/app/AppShell.tsx` (mount `useWebSocket`)

- [ ] **Step 1: Mount `useWebSocket` inside the authenticated shell**

Replace `packages/web/src/app/AppShell.tsx` with:
```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Replace `packages/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { ApiProvider } from './api/ApiProvider';
import { AuthProvider } from './auth/AuthContext';
import { createApiClient } from './api/client';
import { tokenStore } from './auth/tokenStore';
import './index.css';

const queryClient = new QueryClient();
const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken: () => tokenStore.get()?.token ?? null,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 3: Verify the AppShell test still passes**

Mounting `useWebSocket` in `AppShell` calls `makeSocket` with the real `WebSocket` during the App routing tests (the authenticated cases). jsdom does not implement `WebSocket`, so guard against a crash: the hook only connects when `token` is set, and in tests it will attempt `new WebSocket(...)`. To keep `App.test.tsx` deterministic and DB/network-free, the hook must tolerate a missing/throwing `WebSocket`. Wrap the `makeSocket` default call so a constructor throw is swallowed:

Adjust `connect()` in `packages/web/src/realtime/useWebSocket.ts`:
```ts
    const connect = () => {
      const url = `${defaultUrl(baseUrl)}?token=${encodeURIComponent(token)}`;
      try {
        socket = makeSocket(url);
      } catch {
        return; // environment without WebSocket (e.g. jsdom tests); skip realtime
      }
      socket.addEventListener('message', (ev) => {
```
And in the cleanup, guard `socket?.close()`:
```ts
    return () => {
      intentionallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
```
Change the `let socket: SocketLike;` declaration to `let socket: SocketLike | undefined;`.

Re-run the WS tests to confirm the guard didn't break them:
Run: `npm test -w @notreclaim/web -- useWebSocket`
Expected: PASS (the fake `makeSocket` never throws, so behavior is unchanged).

- [ ] **Step 4: Full web suite + build**

Run: `npm test -w @notreclaim/web`
Expected: PASS — all suites (client, ApiProvider, tokenStore, AuthContext, SignIn, AuthCallback, App, events, useWebSocket) green, and no jsdom `WebSocket` crash in the App tests.
Run: `npm run build -w @notreclaim/web`
Expected: `tsc` clean and `vite build` succeeds.

- [ ] **Step 5: Full monorepo verification**

Run (Postgres running): `npm test --workspaces --if-present`
Expected: all packages green (the server suite includes the new auth redirect + config tests; `@notreclaim/web` is new).
Run: `npm run build --workspaces --if-present`
Expected: no TypeScript/build errors anywhere.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/main.tsx packages/web/src/app/AppShell.tsx packages/web/src/realtime/useWebSocket.ts
git commit -m "feat(web): compose providers and mount realtime hook in the app shell"
```

---

## Self-Review

**Spec coverage:**
- `packages/web` scaffold (Vite/React/TS/Tailwind/TanStack Query/React Router/Vitest) → Task 2. ✅
- Dev proxy for the API paths + `/ws` → Task 2 (`vite.config.ts`). ✅
- Typed `ApiClient` (bearer auth, `ApiError`, all endpoints) + hand-defined DTOs → Task 3. ✅
- `ApiProvider`/`useApi` DI → Task 4. ✅
- `tokenStore` + `AuthContext` → Task 5. ✅
- Redirect-with-token sign-in (`SignIn`, `AuthCallback`) + the server callback change → Tasks 6 and 1. ✅
- App shell, `Sidebar` (nav + connection status + sign-out), `ProtectedRoute`, placeholder pages, routes → Task 7. ✅
- `useWebSocket` invalidating `['schedule']`/`['tasks']` per event type, injectable socket, reconnect, mounted only when authed → Tasks 8 and 9. ✅
- Provider composition in `main.tsx` → Task 9. ✅
- Server `WEB_CLIENT_URL` config + 302 redirect (JSON fallback) + tests → Task 1. ✅
- Deterministic tests (mocked `ApiClient`, fake WebSocket, no real network/Google) → throughout; WS guard for jsdom → Task 9. ✅

**Placeholder scan:** No TBD/TODO. The placeholder *pages* are an intentional 5a deliverable. Every code step contains complete code.

**Type consistency:** `ApiClient` interface (Task 3) is the exact shape faked in `fakeApiClient` (Task 6) and consumed via `useApi` (Task 4, used by `SignIn`). `StoredAuth`/`tokenStore` (Task 5) match `AuthContext` and `AuthCallback`'s `setAuth({token,userId})`. `ServerEvent` + `invalidateForEvent` (Task 8) are consumed by `useWebSocket` (Task 8) with the `SocketLike` interface used by both the hook and `FakeSocket`. `webClientUrl` is added to `ServerConfig` (Task 1 config) and `AppDeps.config` (Task 1 app) and read in `auth-routes.ts` and set in `fakes.ts` — consistent across the server change.
