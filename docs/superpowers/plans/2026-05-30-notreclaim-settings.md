# Settings Page (Milestone 5d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/settings` page in `packages/web` (working hours, timezone, horizon, default chunk sizes) and fold in the 5c follow-on so the Tasks quick-add uses the configured default chunk sizes. **Final sub-milestone — completes milestone 5 and the project.**

**Architecture:** Mirror 5b/5c. `api/queries.ts` gains a settings query key + a query and a mutation hook (mutation invalidates settings + schedule). A pure `settingsForm.ts` (state shape, defaults, validation, conversions, timezone list). A `SettingsForm` component (controlled form, Mon-first working-hour rows, IANA timezone select, scheduling fields, Save). A `Settings` page that fetches settings, treats a `404` as first-time setup (seed defaults), and renders the form. The quick-add fold-in adds an optional `defaults` arg to `defaultQuickAddInput` and a best-effort settings query on the Tasks page.

**Tech Stack:** React 18 + Vite + TS strict + TanStack Query v5; Vitest + @testing-library/react + jsdom. Web imports EXTENSIONLESS; never `import React` (jsx:react-jsx; `useState`/`useMemo` from `react` OK). Web tests run under `TZ=UTC`. `build` (`tsc -p tsconfig.json && vite build`) typechecks test files.

**Conventions reminder:** pure modules (`settingsForm.ts`, `taskForm.ts`) use no `Date.now()`/argless `new Date()`. The `Settings`/`Tasks` pages are the impure boundary (`Intl.DateTimeFormat().resolvedOptions().timeZone`, `Date.now` allowed). Tests use `fakeApiClient` + `renderWithProviders` from `src/test/fakes.tsx`. `GET /settings` returns **404** (`ApiError`) when unconfigured.

---

## File Structure

- `src/api/queries.ts` (modify) + `src/api/queries.test.tsx` (extend) — settings key + hooks.
- `src/app/settings/settingsForm.ts` (+ `.test.ts`) — pure state/defaults/validation/conversions/timezones.
- `src/app/settings/SettingsForm.tsx` (+ `.test.tsx`) — the controlled form.
- `src/app/pages/Settings.tsx` (replace placeholder) + `src/app/pages/Settings.test.tsx` — page with 404→defaults.
- `src/app/tasks/taskForm.ts` (modify) + `src/app/tasks/taskForm.test.ts` (extend) — `defaultQuickAddInput` defaults param.
- `src/app/pages/Tasks.tsx` (modify) + `src/app/pages/Tasks.test.tsx` (extend) — best-effort settings query → quick-add chunk defaults.

---

## Task 1: `api/queries.ts` — settings key + query/mutation hooks

**Files:**
- Modify: `packages/web/src/api/queries.ts`
- Modify: `packages/web/src/api/queries.test.tsx`

- [ ] **Step 1: Add failing tests to `src/api/queries.test.tsx`**

Add `useSettingsQuery, useUpdateSettingsMutation` to the import from `./queries`, then add:

```tsx
describe('useSettingsQuery', () => {
  it('calls getSettings and returns data', async () => {
    const getSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ getSettings } as never);
    const { Wrapper } = wrap(api);
    const { result } = renderHook(() => useSettingsQuery(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSettings).toHaveBeenCalled();
    expect(result.current.data).toEqual({ id: 's1' });
  });
});

describe('useUpdateSettingsMutation', () => {
  it('calls putSettings and invalidates settings + schedule', async () => {
    const putSettings = vi.fn(async () => ({ id: 's1' }));
    const api = fakeApiClient({ putSettings } as never);
    const { Wrapper, qc } = wrap(api);
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const { result } = renderHook(() => useUpdateSettingsMutation(), { wrapper: Wrapper });
    result.current.mutate({ timezone: 'UTC', workingHours: [], defaultMinChunkMs: 1, maxChunkMs: 1 } as never);
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['settings'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: FAIL — `useSettingsQuery`/`useUpdateSettingsMutation` not exported.

- [ ] **Step 3: Extend `src/api/queries.ts`**

Add `SettingsInput` to the type import (it currently imports the task/habit inputs):

```ts
import type { CreateTaskInput, UpdateTaskInput, CreateHabitInput, UpdateHabitInput, SettingsInput } from './types';
```

Add to the `queryKeys` object (after the `habits` entry):

```ts
  settingsRoot: ['settings'] as const,
  settings: () => ['settings'] as const,
```

Append to the end of the file:

```ts
export function useSettingsQuery() {
  const api = useApi();
  return useQuery({ queryKey: queryKeys.settings(), queryFn: () => api.getSettings() });
}

export function useUpdateSettingsMutation() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SettingsInput) => api.putSettings(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.settingsRoot });
      void qc.invalidateQueries({ queryKey: queryKeys.scheduleRoot });
    },
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/api/queries.test.tsx`
Expected: PASS. (The 5a `fakeApiClient` base already has `getSettings`/`putSettings` — verify in `src/test/fakes.tsx`; no fake change needed.)

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/api/queries.ts packages/web/src/api/queries.test.tsx
git commit -m "feat(web): settings query key + useSettingsQuery/useUpdateSettingsMutation"
```

---

## Task 2: `settingsForm.ts` (pure)

**Files:**
- Create: `packages/web/src/app/settings/settingsForm.ts`
- Create: `packages/web/src/app/settings/settingsForm.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { Settings } from '../../api/types';
import {
  toFormState, defaultFormState, validateSettingsForm, toSettingsInput, type SettingsFormState,
} from './settingsForm';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'America/New_York',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<SettingsFormState> = {}): SettingsFormState => ({
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000, ...over,
});

describe('settingsForm', () => {
  it('toFormState maps workingHours → per-day windows, off days disabled', () => {
    const s = toFormState(settings());
    expect(s.timezone).toBe('America/New_York');
    expect(s.horizonDays).toBe(7);
    expect(s.days).toHaveLength(7);
    const mon = s.days.find((d) => d.weekday === 1)!;
    expect(mon).toEqual({ weekday: 1, enabled: true, start: '09:00', end: '17:00' });
    const sun = s.days.find((d) => d.weekday === 0)!;
    expect(sun).toEqual({ weekday: 0, enabled: false, start: '09:00', end: '17:00' });
  });

  it('defaultFormState enables Mon–Fri with sensible defaults', () => {
    const s = defaultFormState('UTC');
    expect(s.timezone).toBe('UTC');
    expect(s.horizonDays).toBe(14);
    expect(s.defaultMinChunkMs).toBe(1_800_000);
    expect(s.defaultMaxChunkMs).toBe(7_200_000);
    expect(s.days.filter((d) => d.enabled).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
  });

  it('validateSettingsForm flags empties, horizon, min>max, and per-enabled-day end<=start', () => {
    expect(validateSettingsForm(validState()).ok).toBe(true);
    expect(validateSettingsForm(validState({ timezone: ' ' })).errors.timezone).toBeTruthy();
    expect(validateSettingsForm(validState({ horizonDays: 0 })).errors.horizonDays).toBeTruthy();
    expect(validateSettingsForm(validState({ horizonDays: 1.5 })).errors.horizonDays).toBeTruthy();
    expect(validateSettingsForm(validState({ defaultMinChunkMs: 8_000_000 })).errors.defaultMaxChunkMs).toBeTruthy();
    const badDay = validState();
    badDay.days = badDay.days.map((d) => (d.weekday === 1 ? { ...d, end: '08:00' } : d));
    expect(validateSettingsForm(badDay).errors.days?.[1]).toBeTruthy();
    // an OFF day with a bad window does NOT error:
    const offBad = validState();
    offBad.days = offBad.days.map((d) => (d.weekday === 0 ? { ...d, enabled: false, end: '00:00' } : d));
    expect(validateSettingsForm(offBad).ok).toBe(true);
  });

  it('toSettingsInput omits off days, sorts, converts to minutes', () => {
    const input = toSettingsInput(validState());
    expect(input.workingHours).toHaveLength(5);
    expect(input.workingHours[0]).toEqual({ weekday: 1, startMinute: 540, endMinute: 1020 });
    expect(input.workingHours.map((w) => w.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(input.timezone).toBe('UTC');
    expect(input.horizonDays).toBe(14);
    expect(input.defaultMinChunkMs).toBe(1_800_000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/settings/settingsForm.test.ts`
Expected: FAIL — `Cannot find module './settingsForm'`.

- [ ] **Step 3: Create `src/app/settings/settingsForm.ts`**

```ts
import type { Settings, SettingsInput } from '../../api/types';
import { minutesToHHMM, hhmmToMinutes } from '../lib/duration';

export interface DayState {
  weekday: number;   // 0=Sun .. 6=Sat
  enabled: boolean;
  start: string;     // "HH:MM"
  end: string;       // "HH:MM"
}

export interface SettingsFormState {
  timezone: string;
  days: DayState[];           // length 7, ordered by weekday 0..6
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

export function toFormState(s: Settings): SettingsFormState {
  const days: DayState[] = WEEKDAYS.map((weekday) => {
    const wh = s.workingHours.find((w) => w.weekday === weekday);
    return wh
      ? { weekday, enabled: true, start: minutesToHHMM(wh.startMinute), end: minutesToHHMM(wh.endMinute) }
      : { weekday, enabled: false, start: '09:00', end: '17:00' };
  });
  return {
    timezone: s.timezone,
    days,
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
  };
}

export function defaultFormState(timezone: string): SettingsFormState {
  return {
    timezone,
    days: WEEKDAYS.map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
    horizonDays: 14,
    defaultMinChunkMs: 30 * 60_000,
    defaultMaxChunkMs: 120 * 60_000,
  };
}

export interface SettingsFormErrors {
  timezone?: string;
  horizonDays?: string;
  defaultMinChunkMs?: string;
  defaultMaxChunkMs?: string;
  days?: Partial<Record<number, string>>;
}

export function validateSettingsForm(s: SettingsFormState): { ok: boolean; errors: SettingsFormErrors } {
  const errors: SettingsFormErrors = {};
  if (!s.timezone.trim()) errors.timezone = 'Timezone is required';
  if (!Number.isInteger(s.horizonDays) || s.horizonDays <= 0) errors.horizonDays = 'Horizon must be a positive whole number of days';
  if (!(s.defaultMinChunkMs > 0)) errors.defaultMinChunkMs = 'Min chunk must be positive';
  if (!(s.defaultMaxChunkMs > 0)) errors.defaultMaxChunkMs = 'Max chunk must be positive';
  else if (s.defaultMinChunkMs > s.defaultMaxChunkMs) errors.defaultMaxChunkMs = 'Max chunk must be ≥ min chunk';

  const days: Partial<Record<number, string>> = {};
  for (const d of s.days) {
    if (d.enabled && hhmmToMinutes(d.start) >= hhmmToMinutes(d.end)) days[d.weekday] = 'End must be after start';
  }
  if (Object.keys(days).length > 0) errors.days = days;

  return { ok: Object.keys(errors).length === 0, errors };
}

export function toSettingsInput(s: SettingsFormState): SettingsInput {
  const workingHours = s.days
    .filter((d) => d.enabled)
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) }));
  return {
    timezone: s.timezone,
    workingHours,
    horizonDays: s.horizonDays,
    defaultMinChunkMs: s.defaultMinChunkMs,
    defaultMaxChunkMs: s.defaultMaxChunkMs,
  };
}

/** Valid IANA zones for the picker. Degrades to [] where Intl.supportedValuesOf is unavailable
 *  (the form prepends the current zone, so the select is always usable). */
export function supportedTimezones(): string[] {
  const intl = Intl as { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/settings/settingsForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/app/settings/settingsForm.ts packages/web/src/app/settings/settingsForm.test.ts
git commit -m "feat(web): pure settingsForm (defaults, validation, conversions, tz list)"
```

---

## Task 3: `SettingsForm` component

**Files:**
- Create: `packages/web/src/app/settings/SettingsForm.tsx`
- Create: `packages/web/src/app/settings/SettingsForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SettingsInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { SettingsForm } from './SettingsForm';
import type { SettingsFormState } from './settingsForm';

const initial = (over: Partial<SettingsFormState> = {}): SettingsFormState => ({
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000, ...over,
});

describe('SettingsForm', () => {
  it('saves the converted input with off days omitted', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC', 'America/New_York']} />);
    fireEvent.click(screen.getByTestId('save'));
    const input = onSave.mock.calls[0]![0] as SettingsInput;
    expect(input.timezone).toBe('UTC');
    expect(input.horizonDays).toBe(14);
    expect(input.workingHours).toHaveLength(5);
    expect(input.workingHours[0]).toEqual({ weekday: 1, startMinute: 540, endMinute: 1020 });
  });

  it('toggling a day off omits it from the saved input', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC']} />);
    fireEvent.click(screen.getByTestId('day-1-toggle'));
    fireEvent.click(screen.getByTestId('save'));
    const input = onSave.mock.calls[0]![0] as SettingsInput;
    expect(input.workingHours).toHaveLength(4);
    expect(input.workingHours.some((w) => w.weekday === 1)).toBe(false);
  });

  it('blocks save and shows a per-day error when end <= start', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC']} />);
    fireEvent.change(screen.getByTestId('day-1-end'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-day-1')).toBeInTheDocument();
  });

  it('reflects a timezone change in the saved input', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC', 'America/New_York']} />);
    fireEvent.change(screen.getByTestId('timezone'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByTestId('save'));
    expect((onSave.mock.calls[0]![0] as SettingsInput).timezone).toBe('America/New_York');
  });

  it('shows ✓ Saved and surfaces an ApiError', () => {
    const { rerender } = render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} justSaved />);
    expect(screen.getByTestId('saved')).toBeInTheDocument();
    rerender(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} error={new ApiError(409, 'conflict', 'Nope')} />);
    expect(screen.getByTestId('form-error')).toHaveTextContent('Nope');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/settings/SettingsForm.test.tsx`
Expected: FAIL — `Cannot find module './SettingsForm'`.

- [ ] **Step 3: Create `src/app/settings/SettingsForm.tsx`**

```tsx
import { useState } from 'react';
import type { SettingsInput } from '../../api/types';
import type { ApiError } from '../../api/client';
import { DurationField } from '../components/DurationField';
import {
  type SettingsFormState, type DayState, validateSettingsForm, toSettingsInput, supportedTimezones,
} from './settingsForm';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

export interface SettingsFormProps {
  initial: SettingsFormState;
  onSave: (input: SettingsInput) => void;
  saving?: boolean;
  error?: ApiError | null;
  justSaved?: boolean;
  timezones?: string[];
}

export function SettingsForm({ initial, onSave, saving = false, error = null, justSaved = false, timezones }: SettingsFormProps) {
  const [form, setForm] = useState<SettingsFormState>(() => initial);
  const { ok, errors } = validateSettingsForm(form);
  const zones = timezones ?? supportedTimezones();
  const zoneOptions = zones.includes(form.timezone) ? zones : [form.timezone, ...zones];

  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setForm((f) => ({ ...f, days: f.days.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)) }));

  const labelCls = 'mb-0.5 block text-[10px] uppercase tracking-wide text-gray-400';
  const ctlCls = 'rounded border border-gray-300 px-2 py-0.5 text-sm';
  const errCls = 'text-[11px] text-red-600';

  return (
    <div data-testid="settings-form" className="max-w-md p-4">
      <h2 className="mb-3 text-lg font-semibold">Settings</h2>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Working hours</h3>
        {MON_FIRST.map((wd) => {
          const day = form.days.find((d) => d.weekday === wd)!;
          const dayErr = errors.days?.[wd];
          return (
            <div key={wd} className="flex items-center gap-2 py-1 text-sm">
              <span className={`w-10 ${day.enabled ? 'font-medium' : 'text-gray-400'}`}>{DAY_LABELS[wd]}</span>
              <input type="checkbox" data-testid={`day-${wd}-toggle`} checked={day.enabled} onChange={(e) => setDay(wd, { enabled: e.target.checked })} />
              <input type="time" data-testid={`day-${wd}-start`} className={ctlCls} disabled={!day.enabled} value={day.start} onChange={(e) => setDay(wd, { start: e.target.value })} />
              <span>–</span>
              <input type="time" data-testid={`day-${wd}-end`} className={ctlCls} disabled={!day.enabled} value={day.end} onChange={(e) => setDay(wd, { end: e.target.value })} />
              {dayErr && <span data-testid={`err-day-${wd}`} className={errCls}>{dayErr}</span>}
            </div>
          );
        })}
      </section>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Timezone</h3>
        <select data-testid="timezone" className={ctlCls} value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
          {zoneOptions.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        {errors.timezone && <p data-testid="err-timezone" className={errCls}>{errors.timezone}</p>}
      </section>

      <section className="mb-4 rounded-lg border border-gray-200 p-3">
        <h3 className="mb-2 text-sm font-semibold">Scheduling</h3>
        <div className="mb-2">
          <label className={labelCls}>Horizon (days)</label>
          <input type="number" data-testid="horizon" className={`${ctlCls} w-20`} value={form.horizonDays} onChange={(e) => setForm((f) => ({ ...f, horizonDays: Number(e.target.value) }))} />
          {errors.horizonDays && <p data-testid="err-horizonDays" className={errCls}>{errors.horizonDays}</p>}
        </div>
        <div className="mb-2">
          <label className={labelCls}>Default min chunk</label>
          <DurationField valueMs={form.defaultMinChunkMs} onChange={(ms) => setForm((f) => ({ ...f, defaultMinChunkMs: ms }))} testid="min" />
          {errors.defaultMinChunkMs && <p data-testid="err-defaultMinChunkMs" className={errCls}>{errors.defaultMinChunkMs}</p>}
        </div>
        <div className="mb-2">
          <label className={labelCls}>Default max chunk</label>
          <DurationField valueMs={form.defaultMaxChunkMs} onChange={(ms) => setForm((f) => ({ ...f, defaultMaxChunkMs: ms }))} testid="max" />
          {errors.defaultMaxChunkMs && <p data-testid="err-defaultMaxChunkMs" className={errCls}>{errors.defaultMaxChunkMs}</p>}
        </div>
      </section>

      {error && <p data-testid="form-error" className={errCls}>{error.message}</p>}

      <div className="flex items-center gap-3">
        <button data-testid="save" disabled={!ok || saving} onClick={() => { if (ok) onSave(toSettingsInput(form)); }}
          className="rounded bg-blue-600 px-4 py-1 text-sm text-white disabled:opacity-50">Save</button>
        {justSaved && <span data-testid="saved" className="text-sm text-green-600">✓ Saved</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/settings/SettingsForm.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/app/settings/SettingsForm.tsx packages/web/src/app/settings/SettingsForm.test.tsx
git commit -m "feat(web): SettingsForm (working-hour rows, tz picker, validation, save)"
```

---

## Task 4: `Settings` page (first-time-setup + integration)

**Files:**
- Modify: `packages/web/src/app/pages/Settings.tsx` (replace placeholder)
- Create: `packages/web/src/app/pages/Settings.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import type { Settings } from '../../api/types';
import { ApiError } from '../../api/client';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { Settings as SettingsPage } from './Settings';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC',
  workingHours: [{ weekday: 1, startMinute: 540, endMinute: 1020 }],
  horizonDays: 7, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('Settings page', () => {
  it('shows a loading state', () => {
    const api = fakeApiClient({ getSettings: () => new Promise(() => {}) } as never);
    renderWithProviders(<SettingsPage />, { api });
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it('treats a 404 as first-time setup and seeds defaults (Mon–Fri on)', async () => {
    const api = fakeApiClient({ getSettings: () => Promise.reject(new ApiError(404, 'not_found', 'Settings not configured')) } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect((screen.getByTestId('day-1-toggle') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('day-0-toggle') as HTMLInputElement).checked).toBe(false);
  });

  it('prefills from existing settings and saves the converted input', async () => {
    const putSettings = vi.fn(async () => settings());
    const api = fakeApiClient({ getSettings: async () => settings(), putSettings } as never);
    renderWithProviders(<SettingsPage />, { api });
    await waitFor(() => expect(screen.getByTestId('settings-form')).toBeInTheDocument());
    expect((screen.getByTestId('horizon') as HTMLInputElement).value).toBe('7');
    fireEvent.click(screen.getByTestId('save'));
    await waitFor(() => expect(putSettings).toHaveBeenCalled());
    const input = putSettings.mock.calls[0]![0] as { timezone: string; workingHours: unknown[] };
    expect(input.timezone).toBe('UTC');
    expect(input.workingHours).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Settings.test.tsx`
Expected: FAIL — the placeholder `Settings` renders no form.

- [ ] **Step 3: Replace `src/app/pages/Settings.tsx`**

```tsx
import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { SettingsForm } from '../settings/SettingsForm';
import { toFormState, defaultFormState } from '../settings/settingsForm';

export function Settings() {
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();

  if (settingsQ.isLoading) {
    return <div className="p-6 text-gray-500">Loading settings…</div>;
  }

  const notConfigured = settingsQ.error instanceof ApiError && settingsQ.error.status === 404;
  if (settingsQ.isError && !notConfigured) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn’t load settings.</p>
        <button onClick={() => void settingsQ.refetch()} className="rounded border border-gray-300 px-3 py-1">Retry</button>
      </div>
    );
  }

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initial = settingsQ.data ? toFormState(settingsQ.data) : defaultFormState(browserTz);

  return (
    <SettingsForm
      initial={initial}
      saving={updateM.isPending}
      justSaved={updateM.isSuccess}
      error={updateM.error instanceof ApiError ? updateM.error : null}
      onSave={(input) => updateM.mutate(input)}
    />
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Settings.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full web suite + build**

Run: `npm test -w @notreclaim/web && npm run build -w @notreclaim/web`
Expected: all pass; build clean. (`App.test.tsx` does not navigate to `/settings`, so it is unaffected.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/pages/Settings.tsx packages/web/src/app/pages/Settings.test.tsx
git commit -m "feat(web): Settings page — first-time-setup defaults, prefill, save"
```

---

## Task 5: `taskForm.defaultQuickAddInput` gains an optional `defaults` arg

**Files:**
- Modify: `packages/web/src/app/tasks/taskForm.ts`
- Modify: `packages/web/src/app/tasks/taskForm.test.ts`

- [ ] **Step 1: Add a failing test to `src/app/tasks/taskForm.test.ts`**

Add inside the existing `describe('taskForm', ...)` block:

```ts
  it('defaultQuickAddInput uses provided chunk defaults when given', () => {
    const input = defaultQuickAddInput('Task', NOW, { minChunkMs: 900_000, maxChunkMs: 5_400_000 });
    expect(input.minChunkMs).toBe(900_000);
    expect(input.maxChunkMs).toBe(5_400_000);
    expect(input.durationMs).toBe(3_600_000); // unchanged
  });
```

(The existing test calling `defaultQuickAddInput('  New task  ', NOW)` with two args must still assert the 30m/120m fallback — leave it unchanged.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts`
Expected: FAIL — `defaultQuickAddInput` takes only 2 args (TS error or wrong values).

- [ ] **Step 3: Update `defaultQuickAddInput` in `src/app/tasks/taskForm.ts`**

```ts
export function defaultQuickAddInput(
  title: string,
  now: number,
  defaults?: { minChunkMs: number; maxChunkMs: number },
): CreateTaskInput {
  return {
    title: title.trim(),
    priority: 3,
    durationMs: 60 * 60_000,
    dueBy: new Date(now + 7 * DAY_MS).toISOString(),
    minChunkMs: defaults?.minChunkMs ?? 30 * 60_000,
    maxChunkMs: defaults?.maxChunkMs ?? 120 * 60_000,
    category: null,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/tasks/taskForm.test.ts`
Expected: PASS (the new test + the existing fallback test).

- [ ] **Step 5: Build + commit**

Run: `npm run build -w @notreclaim/web` (clean), then:

```bash
git add packages/web/src/app/tasks/taskForm.ts packages/web/src/app/tasks/taskForm.test.ts
git commit -m "feat(web): defaultQuickAddInput accepts optional chunk defaults"
```

---

## Task 6: Tasks page reads settings chunk defaults (fold-in)

**Files:**
- Modify: `packages/web/src/app/pages/Tasks.tsx`
- Modify: `packages/web/src/app/pages/Tasks.test.tsx`

- [ ] **Step 1: Add failing tests to `src/app/pages/Tasks.test.tsx`**

Add an `ApiError` import and a `settings` fixture near the top of the file:

```ts
import { ApiError } from '../../api/client';
import type { Settings } from '../../api/types';

const settings = (over: Partial<Settings> = {}): Settings => ({
  id: 's1', userId: 'u1', timezone: 'UTC', workingHours: [],
  horizonDays: 14, defaultMinChunkMs: 15 * 60_000, defaultMaxChunkMs: 90 * 60_000,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});
```

Update `makeApi` to stub `getSettings` by default (loaded settings with 15m/90m chunks):

```ts
function makeApi(over = {}) {
  return fakeApiClient({
    listTasks: vi.fn(async () => [task(), task({ id: 't2', title: 'Done thing', status: 'completed' })]),
    createTask: vi.fn(async () => task({ id: 't9' })),
    updateTask: vi.fn(async () => task()),
    deleteTask: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => settings()),
    ...over,
  } as never);
}
```

Add two tests:

```ts
  it('quick-add uses chunk defaults from loaded settings', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    renderWithProviders(<Tasks now={() => NOW} />, { api: makeApi({ createTask }) });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 900_000, maxChunkMs: 5_400_000 })));
  });

  it('quick-add falls back to 30m/120m when settings are unavailable (404)', async () => {
    const createTask = vi.fn(async () => task({ id: 't9' }));
    const api = makeApi({ createTask, getSettings: vi.fn(() => Promise.reject(new ApiError(404, 'not_found', 'x'))) });
    renderWithProviders(<Tasks now={() => NOW} />, { api });
    await waitFor(() => expect(screen.getByText('Write spec')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/add a task/i), { target: { value: 'New thing' } });
    fireEvent.keyDown(screen.getByPlaceholderText(/add a task/i), { key: 'Enter' });
    await waitFor(() => expect(createTask).toHaveBeenCalledWith(expect.objectContaining({ minChunkMs: 1_800_000, maxChunkMs: 7_200_000 })));
  });
```

(The existing "quick-add creates a task with defaults from injected now" test uses `objectContaining({ title, durationMs, dueBy })` — it does not assert chunk sizes, so it still passes with the settings-derived chunks.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @notreclaim/web -- src/app/pages/Tasks.test.tsx`
Expected: FAIL — the new "uses chunk defaults from loaded settings" test fails (quick-add still hard-codes 30m/120m).

- [ ] **Step 3: Wire `useSettingsQuery` into `src/app/pages/Tasks.tsx`**

Add `useSettingsQuery` to the queries import:

```ts
import { useTasksQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery } from '../../api/queries';
```

Inside the component, after the other hooks, derive best-effort chunk defaults and use them in quick-add:

```ts
  const settingsQ = useSettingsQuery();
  const chunkDefaults = settingsQ.data
    ? { minChunkMs: settingsQ.data.defaultMinChunkMs, maxChunkMs: settingsQ.data.defaultMaxChunkMs }
    : undefined;
```

Change the QuickAdd `onAdd` to pass the defaults:

```tsx
        <QuickAdd placeholder="+ Add a task…" onAdd={(title) => createM.mutate(defaultQuickAddInput(title, now(), chunkDefaults))} />
```

(The settings query is best-effort — its loading/error are intentionally ignored; on 404/unavailable, `chunkDefaults` is `undefined` and `defaultQuickAddInput` falls back to 30m/120m.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @notreclaim/web -- src/app/pages/Tasks.test.tsx`
Expected: PASS (all task-page tests, including the two new ones).

- [ ] **Step 5: Run the full web suite + build**

Run: `npm test -w @notreclaim/web && npm run build -w @notreclaim/web`
Expected: all pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/pages/Tasks.tsx packages/web/src/app/pages/Tasks.test.tsx
git commit -m "feat(web): Tasks quick-add uses configured default chunk sizes from settings"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire monorepo test suite**

Ensure the userspace Postgres is running (the `@notreclaim/db` setup runs `prisma migrate deploy`):

```bash
/usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata status >/dev/null 2>&1 || \
  /usr/lib/postgresql/18/bin/pg_ctl -D ~/.local/pgdata -l ~/.local/pgdata/server.log -o "-p 5432 -k /tmp -c listen_addresses=localhost" start
```

Run: `npm test`
Expected: every package passes with **zero failures**. Baselines before 5d: core 27, scheduler 31, google 33, db 35, server 56, web 100. After 5d, web grows by the new suites (queries additions, settingsForm, SettingsForm, Settings page, taskForm/Tasks additions). The only requirement is no failures across all six packages.

- [ ] **Step 2: Build the web package**

Run: `npm run build -w @notreclaim/web`
Expected: clean (`tsc -p tsconfig.json` typechecks test files, then `vite build`).

- [ ] **Step 3: Commit any build-driven fixes (only if needed)**

```bash
git add -A
git commit -m "chore(web): typecheck fixes for 5d"
```

(Skip if the build was already clean.)

---

## Notes for the implementer

- **`fakeApiClient` overrides:** pass `{ ...methods } as never` (matches 5a–5c) — the partial-override variance otherwise complains.
- **`GET /settings` 404 is not an error to the user** — the page renders the first-time-setup form (defaults). Only non-404 query errors show the Retry strip.
- **`Intl.supportedValuesOf` is accessed defensively** (`(Intl as {...}).supportedValuesOf?.(...) ?? []`) to avoid a TS lib dependency and to degrade gracefully; the form prepends the current zone so the select always shows it. Tests inject an explicit `timezones` list.
- **`browserTz`** (`Intl.DateTimeFormat().resolvedOptions().timeZone`) is computed in the page (impure boundary), `'UTC'` under the test `TZ`. `settingsForm.ts` stays pure by taking `timezone` as a parameter.
- **Cross-query timing (Tasks fold-in):** the best-effort settings query resolves from an immediate stub; by the time the task list (`'Write spec'`) is in the DOM, the settings query's data has applied — the same pattern the 5b Planner test relies on. The 404-fallback test seeds a rejecting `getSettings`, so `chunkDefaults` is `undefined` at click time.
- **No `App.test.tsx` change:** no App routing test navigates to `/settings`, and the Tasks page (now calling `getSettings`) is not mounted by App.test. If a future App test mounts either page, add `getSettings` to its `authedApi()` stub.
- **No `import React`; hooks from `react` are fine.** `ApiError` is imported as a **value** in pages/tests that use `instanceof`/`new`, as a **type** in `SettingsForm` (prop annotation only).
