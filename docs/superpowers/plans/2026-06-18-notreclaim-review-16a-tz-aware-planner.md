# Review 16a — Timezone-Aware Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT SAFETY (all subagents):** Do NOT run `git checkout`, `git switch`, `git reset`, `git branch`, or `git stash`. Stay on `feat/review16a-tz-aware-planner`; commit with `git add <named files>` + `git commit` only. Read-only git is fine.

**Goal:** The planner positions and labels days/hours in the user's `settings.timezone` (not the browser's), so a task scheduled at 9am in that zone always displays at 9am; new users default to their detected browser zone.

**Architecture:** `weekModel`'s day-boundary functions take a `zone` (default `'UTC'`) and use luxon for the in-zone midnight/week/day arithmetic; new label helpers format with native `Intl` `timeZone`. The positioning/drag math is unchanged (it works off the zone-correct `dayStartMs`). `Planner` reads `settings.timezone` and threads `zone` through `WeekGrid`→`InteractiveBlock`/`CreatePopover`.

**Tech Stack:** `@notreclaim/web` (React + Vite + luxon). Vitest, web `TZ=UTC`.

**Spec:** `docs/superpowers/specs/2026-06-18-notreclaim-review-16a-tz-aware-planner-design.md`

**Key compatibility note:** every new `zone` parameter **defaults to `'UTC'`**, and label helpers use the same format as today's `toLocaleTimeString`/`toLocaleDateString` — so all existing tests (which run under `TZ=UTC` and don't pass a zone) keep passing unchanged.

---

## Preconditions
- [ ] On branch `feat/review16a-tz-aware-planner` (already created).

---

## Task 1: Zone-aware `weekModel`

**Files:** Modify `packages/web/package.json`, `packages/web/src/app/planner/weekModel.ts`; Test `packages/web/src/app/planner/weekModel.test.ts`

- [ ] **Step 1: Add luxon to the web package.** In `packages/web/package.json`, add to `dependencies`:

```json
    "luxon": "^3.4.4",
```
and to `devDependencies`:
```json
    "@types/luxon": "^3.4.2",
```
Then run `npm install` from the repo root. (luxon is already used by `@notreclaim/core`; this declares it for the web package.)

- [ ] **Step 2: Write failing tests.** In `weekModel.test.ts` add a new describe (keep all existing tests — they stay green):

```ts
import { localMidnight, dayColumns, shiftDays, formatHm, weekdayLabel, dayOfMonth, placeInDay, WINDOW_START_MIN, WINDOW_END_MIN } from './weekModel';

describe('weekModel timezone-aware (America/New_York)', () => {
  const Z = 'America/New_York';
  const noonZ = Date.parse('2026-06-18T16:00:00.000Z'); // 12:00 EDT (UTC-4)

  it('localMidnight returns the zone midnight (04:00Z in summer EDT)', () => {
    expect(localMidnight(noonZ, Z)).toBe(Date.parse('2026-06-18T04:00:00.000Z'));
  });
  it('dayColumns steps zone days', () => {
    const cols = dayColumns(localMidnight(noonZ, Z), 2, Z);
    expect(cols[0]).toBe(Date.parse('2026-06-18T04:00:00.000Z'));
    expect(cols[1]).toBe(Date.parse('2026-06-19T04:00:00.000Z'));
  });
  it('shiftDays preserves wall-clock in the zone', () => {
    expect(shiftDays(noonZ, 1, Z)).toBe(Date.parse('2026-06-19T16:00:00.000Z'));
  });
  it('formats labels in the zone', () => {
    expect(formatHm(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe('09:00 AM'); // 13:00Z = 9am EDT
    expect(weekdayLabel(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe('Thu');
    expect(dayOfMonth(Date.parse('2026-06-18T13:00:00.000Z'), Z)).toBe(18);
  });
  it('places a 09:00-EDT block against the zone midnight at 540/1440', () => {
    const dayStart = localMidnight(noonZ, Z);
    const pos = placeInDay(Date.parse('2026-06-18T13:00:00.000Z'), Date.parse('2026-06-18T14:00:00.000Z'), dayStart)!;
    expect(pos.topPct).toBeCloseTo((540 / (WINDOW_END_MIN - WINDOW_START_MIN)) * 100, 5);
  });
});
```

> `formatHm` format note: today's labels use `toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})` → `"09:00 AM"` under en-US. Implement `formatHm` with the same options so this assertion (and existing label tests) match.

- [ ] **Step 3: Run — expect FAIL** (helpers undefined; zone params ignored).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement.** In `weekModel.ts`:

Add the import at the top:
```ts
import { DateTime } from 'luxon';
```

Replace the four boundary functions (`startOfWeek`, `dayColumns`, `addWeeks`, `localMidnight`, `shiftDays`) with zone-aware luxon versions (default `zone='UTC'` keeps current behavior under `TZ=UTC`):

```ts
/** Monday 00:00 of the week containing `now`, in `zone`. */
export function startOfWeek(now: number, zone = 'UTC'): number {
  return DateTime.fromMillis(now, { zone }).startOf('week').toMillis(); // luxon weeks start Monday
}

/** `count` consecutive zone-midnight timestamps starting at `startMs` (default 7). */
export function dayColumns(startMs: number, count = 7, zone = 'UTC'): number[] {
  const base = DateTime.fromMillis(startMs, { zone });
  return Array.from({ length: count }, (_, i) => base.plus({ days: i }).startOf('day').toMillis());
}

/** The zone-midnight `weeks` weeks from `weekStartMs`. */
export function addWeeks(weekStartMs: number, weeks: number, zone = 'UTC'): number {
  return DateTime.fromMillis(weekStartMs, { zone }).plus({ weeks }).startOf('day').toMillis();
}

/** Zone midnight (00:00) of the day containing `ms`. */
export function localMidnight(ms: number, zone = 'UTC'): number {
  return DateTime.fromMillis(ms, { zone }).startOf('day').toMillis();
}

/** Shift a timestamp by whole days in `zone` (DST-safe; preserves wall-clock time). */
export function shiftDays(ms: number, days: number, zone = 'UTC'): number {
  if (days === 0) return ms;
  return DateTime.fromMillis(ms, { zone }).plus({ days }).toMillis();
}
```

Add the label helpers (place near the bottom; native `Intl` keeps the exact current format):

```ts
/** Time-of-day label (e.g. "09:00 AM") of `ms` rendered in `zone`. */
export function formatHm(ms: number, zone = 'UTC'): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: zone });
}
/** 3-letter weekday (e.g. "Mon") of `ms` in `zone`. */
export function weekdayLabel(ms: number, zone = 'UTC'): string {
  return new Date(ms).toLocaleDateString([], { weekday: 'short', timeZone: zone });
}
/** Day-of-month number of `ms` in `zone`. */
export function dayOfMonth(ms: number, zone = 'UTC'): number {
  return Number(new Date(ms).toLocaleDateString('en-US', { day: 'numeric', timeZone: zone }));
}
```

`placeInDay`, `nowLine`, `isToday`, `snapMinutes`, `pxToMinutes`, `minutesToPx`, `snapClickToSlot`,
`clampDayDelta`, `clampToWindow`, `daysThatFit`, and all constants are unchanged.

- [ ] **Step 5: Run — expect PASS** (new + all existing weekModel tests).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/weekModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add packages/web/package.json package-lock.json packages/web/src/app/planner/weekModel.ts packages/web/src/app/planner/weekModel.test.ts
git commit -m "feat(web): zone-aware weekModel day math + in-zone label helpers (luxon)"
```

---

## Task 2: New-user timezone default = browser zone

**Files:** Modify `packages/web/src/app/settings/settingsForm.ts`; Test `packages/web/src/app/settings/settingsForm.test.ts`

- [ ] **Step 1: Write a failing test.** In `settingsForm.test.ts` add:

```ts
  it('defaultFormState uses the browser timezone', () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(defaultFormState(tz).timezone).toBe(tz);
    // and the no-arg/derived default also resolves to a real zone, not a hardcoded mismatch
  });
```

> Open the file: `defaultFormState(timezone)` already takes a `timezone` arg. The change is the **call sites/initial value** — confirm callers pass the browser zone. If `defaultFormState` is called with a hardcoded `'UTC'` anywhere, switch that to `Intl.DateTimeFormat().resolvedOptions().timeZone`. Adjust the test to assert the actual default path used by the Settings page.

- [ ] **Step 2: Run — expect FAIL** (if a hardcoded default exists) / **PASS trivially** (if `defaultFormState` already forwards the arg). If it already forwards, instead assert the Settings page's fallback: grep for `defaultFormState(` usages and make the fallback `Intl.DateTimeFormat().resolvedOptions().timeZone`.

Run: `cd packages/web && TZ=UTC npx vitest run src/app/settings/settingsForm.test.ts`

- [ ] **Step 3: Implement.** Ensure the timezone default resolves to the browser zone. In `settingsForm.ts`, add a helper and use it as the default:

```ts
export function browserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
```
and update any `defaultFormState('UTC')`/hardcoded call site (search `defaultFormState(` and the Settings page) to pass `browserTimezone()`.

- [ ] **Step 4: Run — expect PASS.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/settings/settingsForm.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/web/src/app/settings/settingsForm.ts packages/web/src/app/settings/settingsForm.test.ts
git commit -m "feat(web): default a new user's timezone to their browser zone"
```

---

## Task 3: Thread the zone through the planner

**Files:** Modify `Planner.tsx`, `WeekGrid.tsx`, `InteractiveBlock.tsx`, `CreatePopover.tsx`; Tests `WeekGrid.test.tsx`, `Planner.test.tsx`

- [ ] **Step 1: Write failing tests.**

In `WeekGrid.test.tsx` add (renderGrid exists; pass a zone + a 13:00Z block):
```ts
  it('labels a block in the provided timezone', () => {
    const day = new Date('2026-06-18T04:00:00.000Z').getTime(); // NY midnight
    const blocks = [block({ id: 'b1', title: 'Morning', startsAt: '2026-06-18T13:00:00.000Z', endsAt: '2026-06-18T14:00:00.000Z' })];
    renderGrid({ days: [day], blocks, nowMs: Date.parse('2026-06-18T16:00:00.000Z'), zone: 'America/New_York' });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Morning'))!;
    expect(tile.textContent).toMatch(/09:00 AM/); // 13:00Z = 9am EDT
  });
```

In `Planner.test.tsx`, extend `makeApi` to provide `getSettings` returning `{ timezone: 'America/New_York', workingHours: [], horizonDays: 14, defaultMinChunkMs: 1, defaultMaxChunkMs: 1 }` and add:
```ts
  it('renders the schedule range query for the settings timezone', async () => {
    // with NY zone, today's column start is NY midnight (04:00Z), not browser-UTC midnight
    const getSchedule = vi.fn(async () => blocks);
    const api = makeApi({ getSchedule, getSettings: async () => ({ id:'s', userId:'u1', timezone:'America/New_York', workingHours:[], horizonDays:14, defaultMinChunkMs:1, defaultMaxChunkMs:1, meetingBufferMs:0, taskBufferMs:0, createdAt:'', updatedAt:'' } as never) });
    renderWithProviders(<Planner now={() => NOW} />, { api });
    await waitFor(() => expect(getSchedule).toHaveBeenCalled());
    const firstFrom = (getSchedule.mock.calls.at(-1)! as unknown[])[0];
    expect(firstFrom).toBe('2026-01-07T05:00:00.000Z'); // NY midnight of 2026-01-07 (EST, UTC-5 in January)
  });
```

> Note Jan is EST (UTC-5): NY midnight of 2026-01-07 = `2026-01-07T05:00:00.000Z`. If `getSettings` is unset elsewhere, the planner falls back to the browser zone (UTC) and prior tests keep their UTC ranges.

- [ ] **Step 2: Run — expect FAIL.**

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.**

**`Planner.tsx`** — read the zone and thread it:
```ts
import { useSettingsQuery, /* …existing… */ } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, localMidnight, clampToWindow, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
```
Inside the component:
```ts
  const settingsQ = useSettingsQuery();
  const zone = settingsQ.data?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [viewStartMs, setViewStartMs] = useState(() => localMidnight(now(), zone));
```
Use `zone` in: `dayColumns(viewStartMs, dayCount, zone)`, `onPrev/onNext` → `shiftDays(ms, ∓dayCount, zone)`, `onToday` → `localMidnight(now(), zone)`, `weekLabel(days, zone)`, and pass `zone={zone}` to `<WeekGrid>`. Update `weekLabel` to format in zone:
```ts
function weekLabel(days: number[], zone = 'UTC'): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone });
  return `${fmt(days[0]!)} – ${fmt(days[days.length - 1]!)}`;
}
```
(Because `viewStartMs` initialises before `settingsQ` resolves, also re-anchor when the zone arrives: add `useEffect(() => setViewStartMs(localMidnight(now(), zone)), [zone]);` — guard so it only resets when the zone actually changes.)

**`WeekGrid.tsx`** — add `zone?: string` to `WeekGridProps` (default `'UTC'` in the destructure). Replace `timeLabel(...)`→`formatHm(..., zone)`, `dayLabel(d)`→`weekdayLabel(d, zone)`, `new Date(d).getDate()`→`dayOfMonth(d, zone)`; auto-scroll uses `localMidnight(nowMs, zone)`; pass `zone={zone}` to `<InteractiveBlock>` and `<CreatePopover>`. Import `formatHm, weekdayLabel, dayOfMonth, localMidnight` from weekModel.

**`InteractiveBlock.tsx`** — add `zone?: string` (default `'UTC'`); replace the local `fmtTime`/`toLocaleTimeString` with `formatHm(ms, zone)` (import `formatHm`). The drag commit (`iso(dayStart + min*60000)`) is unchanged.

**`CreatePopover.tsx`** — add `zone?: string` (default `'UTC'`); replace `fmt(ms)` with `formatHm(ms, zone)` (import it). The `iso()`/payload is unchanged.

- [ ] **Step 4: Run — expect PASS** (new + existing).

Run: `cd packages/web && TZ=UTC npx vitest run src/app/planner/WeekGrid.test.tsx src/app/pages/Planner.test.tsx src/app/planner/InteractiveBlock.test.tsx src/app/planner/CreatePopover.test.tsx`
Expected: PASS.

- [ ] **Step 5: Full web suite + build, then commit.**

Run: `cd packages/web && npm test` then `npm --workspace @notreclaim/web run build`
Expected: all pass; clean build.

```bash
git add packages/web/src/app/pages/Planner.tsx packages/web/src/app/planner/WeekGrid.tsx packages/web/src/app/planner/InteractiveBlock.tsx packages/web/src/app/planner/CreatePopover.tsx packages/web/src/app/planner/WeekGrid.test.tsx packages/web/src/app/pages/Planner.test.tsx
git commit -m "feat(web): render the planner in the settings timezone"
```

---

## Task 4: Verify & finish

- [ ] **Step 1: Full web suite + build.**
```bash
(cd packages/web && npm test)
npm run build
```
Expected: green; clean.

- [ ] **Step 2: Set the demo timezone + live-verify.** Set the demo user's tz to America/New_York, restart Vite (clear cache), and geckodriver with `TZ=America/New_York`:
```bash
TOKEN="…demo…"; curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"timezone":"America/New_York","workingHours":[{"weekday":1,"startMinute":540,"endMinute":1020},{"weekday":2,"startMinute":540,"endMinute":1020},{"weekday":3,"startMinute":540,"endMinute":1020},{"weekday":4,"startMinute":540,"endMinute":1020},{"weekday":5,"startMinute":540,"endMinute":1020}],"defaultMinChunkMs":1800000,"defaultMaxChunkMs":3600000}' \
  http://localhost:3000/settings
# then re-plan so blocks land in NY working hours
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/schedule/replan
```
Confirm in the browser (TZ=America/New_York geckodriver): working-hours blocks now render at **9am–5pm** (not 5am–1pm), the now-line/auto-scroll land on the correct in-zone time, and tile labels read in-zone.

- [ ] **Step 3: Update memory** (`project-status.md` + `MEMORY.md`) with the Review 16a summary (planner renders in settings.timezone; luxon; browser-zone default).

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review16a-tz-aware-planner` to `main`.

---

## Self-review notes (reconciled)
- **Spec coverage:** zone-aware day math + labels (Task 1); browser-zone default (Task 2); thread zone through planner components (Task 3); demo tz + live verify (Task 4).
- **Compatibility:** all zone params default `'UTC'`; label helpers reuse the existing `toLocaleTimeString`/`toLocaleDateString` format → existing `TZ=UTC` tests pass unchanged.
- **Unchanged math:** `placeInDay`/`nowLine`/drag commit operate off the zone-correct `dayStartMs`; pixel↔minute helpers are zone-independent.
- **Known limit:** fixed 1440-min grid → ±1h on the 2 DST-transition days/year (documented).
