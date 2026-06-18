# NotReclaim — Review 16a: Timezone-aware planner (design)

Date: 2026-06-18

## Problem (from systematic debugging)

The scheduler plans within working hours expressed in `settings.timezone` and stores
blocks as UTC instants. The planner, however, does ALL day/hour math in the **browser's**
local timezone (`Date#setHours`, `getDay`, `toLocaleTimeString`) and never reads
`settings.timezone`. When the two differ (demo: settings = `UTC`, browser = `America/New_York`),
every block displays shifted by the offset — 09:00-UTC working hours render at 05:00 EDT.
Review 15's full-day view exposed this (the 5am blocks used to be clipped).

This is the root cause of the "tasks at 5am despite 9am working hours" report and the
"wrong hours" in the move/start reports. Fix: render the planner in `settings.timezone`.

## Goal

The planner positions and labels every block/day/hour in the user's `settings.timezone`,
so a task scheduled at 9am in that zone always displays at 9am, regardless of the browser
timezone. New users default to their detected browser zone so it stays consistent.

## Non-goals

- No scheduler change (the engine already uses `settings.timezone` via luxon).
- The grid stays a fixed 24×58px height, so the 2 DST-transition days/year are off by up
  to an hour in the evening — accepted (noted).
- Overlapping-tile layout and the "extra tile" reconcile UX are separate reviews (16b, 16c).

## Approach

### Dependency
Add **luxon** to `packages/web/package.json` dependencies (already used by `@notreclaim/core`;
hoisted at the repo root). Gives correct zone + DST arithmetic.

### `weekModel.ts` — make the day-boundary functions zone-aware
The block-positioning math (`placeInDay`, `nowLine`, the WeekGrid column filter, the drag
commit) already works off a `dayStartMs` reference + ms arithmetic, so it stays correct as
long as **`dayStartMs` is the zone's midnight**. So the zone only needs to enter the
day-boundary computation and the labels:

- `localMidnight(ms, zone)` → `DateTime.fromMillis(ms, { zone }).startOf('day').toMillis()`
- `startOfWeek(now, zone)` → `DateTime.fromMillis(now, { zone }).startOf('week').toMillis()` (luxon week = Monday)
- `dayColumns(startMs, count, zone)` → `count` successive `DateTime.fromMillis(startMs,{zone}).plus({days:i}).startOf('day').toMillis()`
- `shiftDays(ms, days, zone)` → `DateTime.fromMillis(ms,{zone}).plus({ days }).toMillis()` (DST-safe wall-clock shift)
- `addWeeks(ms, weeks, zone)` → `.plus({ weeks }).startOf('day').toMillis()`
- New formatter `formatHm(ms, zone)` → `DateTime.fromMillis(ms, { zone }).toFormat('h:mm a')` (e.g. "9:00 AM"), replacing the browser-local `toLocaleTimeString` calls for block/slot labels.
- New `weekdayLabel(ms, zone)` (3-letter, e.g. "Mon") and `dayOfMonth(ms, zone)` for the header, replacing `dayLabel(d)`/`new Date(d).getDate()`.

`placeInDay`, `nowLine`, `isToday` keep their `(…, dayStartMs)` signatures and ms math
(no zone param needed — `dayStartMs` carries the zone). `snapMinutes`, `pxToMinutes`,
`minutesToPx`, `snapClickToSlot`, `clampToWindow`, `clampDayDelta`, `daysThatFit`,
`HOUR_ROW_PX`, `GRID_COLUMN_PX`, `WINDOW_*` are zone-independent — unchanged.

### Thread the zone through the planner
- `Planner`: `const zone = useSettingsQuery().data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;`
  Use `zone` for `viewStartMs = localMidnight(now(), zone)`, `dayColumns(viewStartMs, dayCount, zone)`,
  the Prev/Next `shiftDays(…, zone)`, Today `localMidnight(now(), zone)`, and pass `zone` to `WeekGrid`.
  `weekLabel(days, zone)` formats the visible range in-zone.
- `WeekGrid`: takes `zone`; uses `weekdayLabel`/`dayOfMonth` for headers, `formatHm` for block
  start labels (`timeLabel`), `isToday(nowMs, d)` (unchanged), the auto-scroll minute-of-day via
  `(nowMs − localMidnight(nowMs, zone))`, and passes `zone` to `InteractiveBlock` and `CreatePopover`.
- `InteractiveBlock`: takes `zone`; its drag-preview label (`fmtTime`) uses `formatHm(ms, zone)`.
  Its commit `iso(dayStartMs + startMin*60000)` is unchanged (dayStartMs is the zone midnight).
- `CreatePopover`: takes `zone`; its slot-label and the times it builds format via the zone.

### New-user timezone default
`settingsForm.ts` `defaultFormState` defaults `timezone` to
`Intl.DateTimeFormat().resolvedOptions().timeZone` (falling back to `'UTC'` if unavailable),
instead of a value that can mismatch the browser.

### Demo data
Set the demo user's `settings.timezone` to `America/New_York` (PUT /settings) during
verification so the planner shows the real local hours.

## Files touched

- `packages/web/package.json` — add `luxon` (+ `@types/luxon` dev).
- `packages/web/src/app/planner/weekModel.ts` — zone params + `formatHm`/`weekdayLabel`/`dayOfMonth`.
- `packages/web/src/app/pages/Planner.tsx` — read `zone`, thread it through.
- `packages/web/src/app/planner/WeekGrid.tsx` — `zone` prop; zone labels/headers/auto-scroll.
- `packages/web/src/app/planner/InteractiveBlock.tsx` — `zone` prop; zone drag label.
- `packages/web/src/app/planner/CreatePopover.tsx` — `zone` prop; zone slot label.
- `packages/web/src/app/settings/settingsForm.ts` — browser-zone default.

## Testing

- **`weekModel.test.ts`**: existing tests run under `TZ=UTC` and now pass `zone='UTC'` (or the
  default param keeps `'UTC'`) so they behave identically. Add zone cases with
  `zone='America/New_York'`: `localMidnight` of a midday instant is the NY midnight (04:00Z in
  winter / 04:00Z EDT summer); `dayColumns(...,'America/New_York')` steps NY days; `formatHm(Date.parse('2026-06-18T13:00:00Z'),'America/New_York')` === `'9:00 AM'`; a block at `13:00Z` placed against the NY-midnight `dayStart` has `topPct = (540/1440)*100`.
- **`WeekGrid`/`Planner`/`CreatePopover`/`InteractiveBlock` tests**: pass an explicit `zone`
  prop (default `'UTC'` keeps current expectations green); add one NY-zone render asserting a
  `13:00Z` block's tile label reads `9:00 AM`.
- **`settingsForm.test.ts`**: `defaultFormState()` timezone equals `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- Tests per-package, web `TZ=UTC`. Live-verify via geckodriver run with `TZ=America/New_York`
  AND demo `settings.timezone='America/New_York'`: the working-hours blocks render at 9am–5pm
  (not 5am–1pm), the now-line and auto-scroll land on the correct in-zone time, and tile labels
  read in-zone.

## Edge cases

- All `weekModel` zone params **default to `'UTC'`** so any caller/test not yet threaded keeps
  the prior (UTC) behavior — lets the change land incrementally and keeps the `TZ=UTC` suite green.
- DST-transition days: the fixed 1440-min grid mis-positions evening blocks by up to an hour on
  those 2 days — accepted.
- If `settings` hasn't loaded yet, the planner falls back to the browser zone (no crash, brief
  reflow when settings arrive).
