# NotReclaim Review 5 — design (popover task params, buffers exposure, category upgrade)

**Date:** 2026-06-10. **Source:** user feedback + AskUserQuestion answers. Branch `feat/review5-categories`.

## User decisions (recorded)
- Calendar create-popover Task mode gains: **Due date, Hours (category), Schedule after**. NOT split/min-max (calendar-created tasks stay one pinned chunk, min=max=duration).
- Buffer ask = **expose the existing global buffers** (Settings meetingBufferMs/taskBufferMs), no per-item buffer model.
- Categories: **rename**, **color + planner tinting**, **own hours for the default category**, and **restyle the Settings page elements to the design system** (no more default browser controls). The "Manage hours…" dropdown link was NOT chosen.

## A. Popover task parameters (web only)
In `CreatePopover` Task mode (new-task path only; hidden when an existing task is picked): **Due date** (`datetime-local`, prefilled clicked-day 23:59 — now editable), **Hours** select (`useCategoriesQuery`, defaults to the default category like the New Task modal; sends `categoryId`), **Schedule after** (`datetime-local`, empty = Now; sends `notBefore` ISO or omits). Styled like the popover's existing controls (bordered rounded inputs, small labels). Event mode unchanged.

## B. Category upgrade (full-stack)
- **DB:** `Category.color String?` (hex like `#5b62e3`; null = no color), migration `20260610020000_category_color`. Repo input types gain `color?: string | null`.
- **Server:** create/update category schemas gain `color: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional()`; the update refine accepts color-only patches. Confirm PATCH already permits editing the DEFAULT category's `windows` (only delete is blocked) — if not, allow it.
- **Default category hours:** the Settings Categories editor lets the default define its own weekly windows (`windows` array) or reset to **"Use global working hours"** (`windows: null`). Core `assemble` already falls back per-category (`windows ?? settings.workingHours`) — verify, no engine change expected.
- **Rename:** inline name editing for every category (default included) via the existing PATCH.
- **Color picker:** fixed swatch palette (~8 design-system-friendly hexes + "none"); stored on the category.

## C. Planner tinting (web)
Task blocks tinted by their task's category color, KEEPING the state semantics from Review-1A: locked → solid `color` bg + white text + 🔒; movable → dashed border + text in `color`; meetings stay blue; habits and tasks without a colored category keep today's green styling. Implementation: `Planner` fetches categories, builds taskId→color; WeekGrid items carry `accent?: string`; `EventBlock`/`InteractiveBlock` apply inline styles when accent is set (computed-hex inline styles are sanctioned).

## D. Settings page re-skin + buffers exposure (web)
`SettingsForm`, `CategoriesSection`, `WeeklyHoursEditor` rebuilt on the shared design system (FieldBox, pill buttons, styled selects/time inputs, indigo accents) — no default browser-styled controls. Buffers get a clearly-labeled **"Scheduling buffers"** subsection (meeting buffer / task gap, minutes, styled). Behavior, validation, testids preserved unless a control type itself changes.

**Out of scope:** per-item buffers; per-category default chunk sizes; "Manage hours…" links; tinting on the Priorities board.
