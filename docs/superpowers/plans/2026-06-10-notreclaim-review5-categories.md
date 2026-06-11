# Review 5: Popover Params + Category Upgrade + Settings Re-skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is CONTRACT-level: read every file you touch before editing and follow its established idioms (fixtures, providers, testids). TDD throughout: failing test → implement → green → commit.

**Spec:** `docs/superpowers/specs/2026-06-10-notreclaim-review-5-design.md`. **Branch:** `feat/review5-categories` off `main`. Suite baseline **504** (core 47, db 50, google 33, scheduler 40, server 86, web 248).

---

### Task 1: Popover task parameters (web, TDD)

**Files:** `packages/web/src/app/planner/CreatePopover.tsx` + test.

Contract (Task mode, new-task path ONLY — all three hidden when an existing task is selected or in Event mode):
- **Due date**: `datetime-local`, `data-testid="create-due"`, prefilled from the clicked day at 23:59 local (compute via the same `dayStartMs + (23*60+59)*60_000` the submit already uses, formatted with `isoToLocalInput` from `../lib/duration`); user edits flow into `createTask`'s `dueBy` (convert with `localInputToIso`). Empty value blocks submit (dueBy is required).
- **Hours**: category select `data-testid="create-category"` via `useCategoriesQuery`; default-select the `isDefault` category once loaded (mirror NewTaskModal's useEffect pattern); sends `categoryId` (omit when none chosen).
- **Schedule after**: `datetime-local`, `data-testid="create-after"`, default empty (= Now); when set, `createTask` gets `notBefore: localInputToIso(value)`.
- Compact styling consistent with the popover (small inkSoft label + bordered rounded input, like the title input).

Tests (extend CreatePopover.test.tsx; follow its harness): (1) task mode shows the three fields prefilled (due = `2026-01-05T23:59` for the DAY fixture; after empty); event mode and existing-task selection hide them; (2) submitting with edited due/after/category asserts the `createTask` payload (`dueBy`/`notBefore` ISO, `categoryId`); (3) existing tests stay green (the default-due submit value is unchanged).

Gates: `cd packages/web && TZ=UTC npx vitest run src/app/planner/ && npm test && npx tsc -p tsconfig.json --noEmit`.
Commit: `feat(web): due date, category, and schedule-after options in the planner create popover`

---

### Task 2: Category color + rename + default-windows (db → server → web Settings, TDD)

**Files:** db schema + migration `20260610020000_category_color` + `category-repository.ts` (+ repo test); server `schemas.ts` + `category-routes` check (+ `category-routes.test.ts`, fakes' `fakeCategoryRepo.make` gains `color: null`); web `api/types.ts` (Category.color: string | null; inputs `color?`), `app/settings/categoryForm.ts` + `CategoriesSection.tsx` + `WeeklyHoursEditor.tsx` (+ tests), `test/fakes` category fixtures.

Contracts:
1. **DB:** `color String?` on Category; migration `ALTER TABLE "Category" ADD COLUMN "color" TEXT;`. `CreateCategoryInput`/`UpdateCategoryInput` gain `color?: string | null`. Repo test: create with color, patch color to null.
2. **Server:** both category schemas accept `color` (hex-validated, nullable optional); update refine = at least one of name/windows/color. Verify PATCH allows updating the DEFAULT category's windows/name/color (only DELETE is blocked) — add a test proving default-category PATCH works.
3. **Core check (no code change expected):** confirm `assemble` uses `category.windows ?? settings.workingHours` per category so a default WITH windows uses them — if the fallback is keyed on `isDefault` instead of null-windows, fix to null-windows semantics + core test.
4. **Web Settings — Categories section:**
   - **Rename**: each category row's name becomes an editable input (default included), saved via the existing update mutation on blur/Enter (`data-testid="cat-name-<id>"`).
   - **Color**: swatch row per category (`data-testid="cat-color-<id>-<hex>"`), palette `['#5b62e3','#4285f4','#0f9d58','#f4b400','#db4437','#9c27b0','#00acc1','#795548']` + a "none" swatch; click PATCHes `{color}`.
   - **Default hours**: the default category row swaps its read-only "Uses your working hours above" for a toggle — "Use global working hours" (PATCH `{windows: null}` — NOTE: the current update schema requires `windows` min(1); change to allow `windows: null` explicitly meaning inherit, i.e. `windows: z.array(...).min(1).nullable().optional()`) vs custom windows via the existing `WeeklyHoursEditor`.
   - Keep all existing behavior/tests for create/delete (delete of default still 409 → error surfaced).

Gates: db/server/core/web package suites + builds green; commit per package or one commit:
`feat: category color, rename, and default-category hours (db/server/settings)`

---

### Task 3: Planner category tinting + Settings re-skin (web, TDD)

**Files:** `app/planner/EventBlock.tsx`, `InteractiveBlock.tsx`, `WeekGrid.tsx`, `pages/Planner.tsx` (+ tests); `app/settings/SettingsForm.tsx`, `CategoriesSection.tsx`, `WeeklyHoursEditor.tsx`, `pages/Settings.tsx` (+ tests).

Contracts:
1. **Tinting:** `Planner` also queries categories; computes `accentByTaskId` (task.categoryId → category.color, skipping null colors); passes to WeekGrid as `accents?: Record<string, string>`; WeekGrid resolves each task block's `accent` (habits/meetings: none) and threads it to InteractiveBlock/EventBlock as `accent?: string`. In BOTH block components: when `accent` set and kind ≠ meeting — pinned: `style.backgroundColor = accent` (className drops `bg-low`, keeps white text + 🔒); movable: `style.borderColor = accent; style.color = accent` (className keeps dashed border, drops the green color classes). No accent → byte-identical current classes. Tests: block with accent renders the inline colors; without accent unchanged; meeting ignores accent.
2. **Settings re-skin:** rebuild `SettingsForm` (timezone select, horizon, default chunk steppers? — chunk defaults may adopt `DurationStepper`, buffers stay minute number-inputs but styled), the weekday hours rows, and `CategoriesSection` on FieldBox/pill components; add a **"Scheduling buffers"** sub-heading grouping meeting buffer + task gap with helper text ("kept free around meetings" / "minimum gap between scheduled blocks"). Preserve testids/behavior; where a control type changes (e.g. chunk h/m inputs → DurationStepper), update the corresponding tests the way M-C did for the drawer.

Gates: full web suite + typecheck green.
Commit: `feat(web): category-tinted planner blocks + design-system Settings page with visible buffers`

---

### Task 4: Suite + live verification + merge

- Root `npm test` green; `npm run build`; `cd packages/db && npx prisma migrate deploy`; restart the API server (`.env.run`).
- Live (geckodriver harness from memory): popover task mode shows due/hours/after and creates with them; Settings shows styled controls + buffers section; rename + color a category; planner blocks tint with that color; default category custom hours round-trip.
- Merge `feat/review5-categories` → main; suite green; delete branch; update memory.
