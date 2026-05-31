# NotReclaim Web Client — Settings Page — Design Spec (Milestone 5d)

**Date:** 2026-05-30
**Status:** Approved (ready for implementation planning)
**Parent design:** `docs/superpowers/specs/2026-05-28-notreclaim-design.md`
**Foundation:** 5a (web-foundation) + 5b (planner-weekview) + 5c (tasks-habits), all merged.
**Depends on:** Milestones 1–5c (all merged). **This is the final sub-milestone — it completes
milestone 5 and the project.**

## Summary

Milestone 5d implements the `/settings` page (replacing the placeholder): a singleton config
form for **working hours** (one window per weekday), **timezone**, **planning horizon**, and
**default min/max chunk sizes**. It consumes the existing `getSettings()`/`putSettings()`
client methods; `PUT /settings` upserts and triggers a re-plan, so the 5b Planner refreshes
via the existing `schedule.updated` WebSocket event. It also folds in the 5c follow-on: the
Tasks quick-add reads `Settings.defaultMin/MaxChunkMs` instead of hard-coded values. No server
work is required.

## Goals

- A `/settings` form: per-weekday working-hour windows (toggle + start/end time), an IANA
  timezone picker, horizon days, and default chunk sizes; Save with confirmation + error
  surfacing; loading / first-time-setup / error states.
- Reuse the established plumbing: `api/queries.ts` (settings key + query/mutation hooks), the
  shared `app/lib/duration.ts` helpers (ms↔h/m, minutes↔"HH:MM"), the `DurationField`
  component, and the pure-form + validation pattern from 5c.
- Fold in the 5c follow-on so quick-add respects the configured chunk defaults.
- Everything testable deterministically (jsdom, mocked `ApiClient`, `TZ=UTC`); no real network.

## Non-Goals (5d)

Multiple working-hour windows per weekday (one window per day; see Decisions). A free-text
timezone field (a validated picker instead). Per-weekday default-chunk overrides. Any new
server endpoint. Server-side settings migration.

## Decisions (locked during brainstorming)

- **Working hours: one window per weekday.** Seven weekday rows, each an on/off toggle + a
  single start/end window. An "on" day contributes one `{weekday, startMinute, endMinute}`
  entry; "off" days are omitted (non-working). The engine supports multiple windows per
  weekday, but the editor is the **authoritative single-window editor** — if settings ever
  contain multiple windows for a day (set via the API directly), it shows the first and a save
  collapses to one. (Multiple windows per day is a later enhancement.)
- **Timezone is a picker of valid IANA zones** (`Intl.supportedValuesOf('timeZone')`), so a
  typo can't pass Zod (`z.string().min(1)`) and then silently break scheduling in the
  *swallowed* background re-plan (`expandWorkingWindows` → `assertValidZone` throws
  `InvalidTimezoneError`, which the 4b re-plan path logs and discards).
- **`GET /settings` returns `404` (not null) when unconfigured.** The page treats an
  `ApiError` with `status === 404` as **first-time setup** — it renders the form seeded with
  `defaultFormState(browserTimezone)`, not an error strip.
- **Fold in the 5c follow-on:** Tasks quick-add uses `Settings.defaultMin/MaxChunkMs` (with a
  30m/120m fallback when settings aren't loaded).

## Data layer — `api/queries.ts`

Add to `queryKeys` (keeping the `*Root` convention):

```ts
  settingsRoot: ['settings'] as const,
  settings: () => ['settings'] as const,
```

- `useSettingsQuery()` → `useQuery({ queryKey: queryKeys.settings(), queryFn: () => api.getSettings() })`.
- `useUpdateSettingsMutation()` → `useMutation({ mutationFn: (body: SettingsInput) => api.putSettings(body), onSuccess: invalidate settingsRoot + scheduleRoot })` (editing settings re-plans the schedule).

`SettingsInput` is imported (already in `api/types.ts`).

## Pure form module — `app/settings/settingsForm.ts` (tested)

No React; deterministic (no `Date.now`/argless `new Date`). `Intl.supportedValuesOf` is
time-independent and allowed.

```ts
export interface DayState { weekday: number; enabled: boolean; start: string; end: string } // "HH:MM"
export interface SettingsFormState {
  timezone: string;
  days: DayState[];          // length 7, indexed/ordered by weekday 0..6
  horizonDays: number;
  defaultMinChunkMs: number;
  defaultMaxChunkMs: number;
}
```

- `toFormState(s: Settings): SettingsFormState` — for each weekday 0..6, the **first** matching
  `workingHours` entry → `{enabled:true, start:minutesToHHMM(startMinute), end:minutesToHHMM(endMinute)}`;
  else `{enabled:false, start:'09:00', end:'17:00'}`. Copies timezone/horizonDays/chunk defaults.
- `defaultFormState(timezone: string): SettingsFormState` — first-time defaults: weekdays 1–5
  enabled 09:00–17:00, 0 & 6 off; `horizonDays:14`; `defaultMinChunkMs:30*60_000`;
  `defaultMaxChunkMs:120*60_000`.
- `validateSettingsForm(s)` → `{ ok, errors }` where
  `errors: { timezone?, horizonDays?, defaultMinChunkMs?, defaultMaxChunkMs?, days?: Partial<Record<number,string>> }`:
  timezone non-empty; `horizonDays` a positive integer; chunks > 0; `defaultMinChunkMs ≤
  defaultMaxChunkMs` (on `defaultMaxChunkMs`); for each **enabled** day,
  `hhmmToMinutes(start) < hhmmToMinutes(end)` (else `days[weekday]`). `ok` = no scalar errors
  and no day errors.
- `toSettingsInput(s): SettingsInput` — `workingHours` = enabled days (sorted by weekday) →
  `{weekday, startMinute:hhmmToMinutes(start), endMinute:hhmmToMinutes(end)}`; plus timezone,
  horizonDays, defaultMin/MaxChunkMs.
- `supportedTimezones(): string[]` — `Intl.supportedValuesOf('timeZone')`.

## Form component — `app/settings/SettingsForm.tsx` (tested)

`SettingsForm({ initial, onSave, saving?, error?, justSaved?, timezones? })` — a
controlled form (`useState(() => initial)`), live `validateSettingsForm` (no Cancel — it's a
full-page form, not a drawer):
- **Working hours:** the 7 `days` rendered **Mon-first** (order `[1,2,3,4,5,6,0]`); each row: a
  toggle (`data-testid="day-{weekday}-toggle"`) flipping `enabled`; start/end `<input
  type="time">` (`day-{weekday}-start` / `-end`, disabled when off); a per-day error
  (`err-day-{weekday}`) when present.
- **Timezone:** `<select>` over `timezones` (default `supportedTimezones()`; tests inject a
  small list). The current `timezone` is preselected (prepended if not in the list).
- **Scheduling:** horizon `<input type="number">` (+ `err-horizonDays`); default min/max chunk
  via `DurationField` (`testid="min"/"max"`, + `err-defaultMaxChunkMs`).
- **Save** (`data-testid="save"`, disabled `!ok || saving`) → `onSave(toSettingsInput(form))`;
  shows **"✓ Saved"** (`data-testid="saved"`) when `justSaved`; surfaces `error.message`
  (`data-testid="form-error"`).

## Page — `app/pages/Settings.tsx` (tested)

`useSettingsQuery()` + `useUpdateSettingsMutation()`. Render branches:
- `isLoading` → "Loading settings…".
- error that **is** `ApiError` 404 → render `<SettingsForm initial={defaultFormState(browserTz)} …>`
  (first-time setup; `browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone`, the page
  being the impure boundary; `'UTC'` under test).
- other error → inline message + Retry (`refetch`).
- data → `<SettingsForm initial={toFormState(data)} …>`.

`onSave={(input) => updateMutation.mutate(input)}`; `saving={updateMutation.isPending}`;
`justSaved={updateMutation.isSuccess}`; `error={updateMutation.error instanceof ApiError ?
updateMutation.error : null}`.

## Quick-add fold-in — `app/tasks/taskForm.ts` + `app/pages/Tasks.tsx`

- `defaultQuickAddInput(title, now, defaults?: { minChunkMs: number; maxChunkMs: number })` —
  uses `defaults` when provided, else `30*60_000` / `120*60_000`. (Duration 60m, priority 3,
  category null, `dueBy = now + 7d` unchanged. The existing 2-arg call sites/tests still pass.)
- `Tasks.tsx` adds a **best-effort** `useSettingsQuery()` (its error/loading are ignored — a
  404 just means "use fallback"); quick-add calls `defaultQuickAddInput(title, now(),
  settings.data ? { minChunkMs: settings.data.defaultMinChunkMs, maxChunkMs:
  settings.data.defaultMaxChunkMs } : undefined)`. `Tasks.test` gains a `getSettings` stub and
  an assertion that quick-add uses the configured chunk sizes.

## Error handling

- Query `404` → first-time-setup form (not an error). Other query errors → inline + Retry.
- Save mutation `ApiError` → message in the form; the form stays editable.
- `401` → handled globally by the 5b interceptor.
- The Tasks-page settings query is best-effort: its failure never blocks the page (quick-add
  falls back to 30m/120m).

## Testing (deterministic; jsdom; no network; `TZ=UTC`)

- **`settingsForm` (pure):** `toFormState` (window→"HH:MM", off-day defaults, first-window
  collapse); `defaultFormState('UTC')` (Mon–Fri on); `validateSettingsForm` (timezone empty,
  horizon ≤ 0, min>max, per-enabled-day end≤start, off days not validated); `toSettingsInput`
  (omits off days, sorts, minutes round-trip).
- **`api/queries`:** `useSettingsQuery` calls `getSettings`; `useUpdateSettingsMutation` calls
  `putSettings` + invalidates `['settings']` and `['schedule']`.
- **`SettingsForm`:** renders rows from `initial`; toggling a day off omits it from the saved
  input; editing a window converts to minutes; tz select changes timezone; an invalid window
  (end ≤ start) disables Save and shows `err-day-{wd}`; `justSaved` shows "✓ Saved"; `error`
  shows `form-error`.
- **`Settings` page:** loading state; **404 → defaults form renders** (Mon–Fri rows present);
  data → prefilled; Save → `putSettings` called with the converted `SettingsInput`.
- **Quick-add fold-in:** `taskForm` test for the `defaults` param; `Tasks` test that quick-add
  with a loaded settings fixture calls `createTask` with the configured `minChunkMs`/`maxChunkMs`.
- **Build/typecheck:** `tsc -p tsconfig.json && vite build` clean.

## Scope

5d is cohesive for one implementation plan: the data-layer hooks, the pure form module, the
form component, the page (with first-time-setup handling), and the small quick-add fold-in.
It is the last sub-milestone of milestone 5 and completes the NotReclaim web client.
