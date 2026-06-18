# Review 16c — Started Tasks Are User-Managed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **GIT SAFETY (all subagents):** Do NOT run `git checkout`, `git switch`, `git reset`, `git branch`, `git stash`, or `git commit --amend`. Stay on `feat/review16c-started-manual`; commit fresh with `git add <named files>` + `git commit`. Read-only git is fine.

**Goal:** Once a task has a Started block, the auto-scheduler stops generating tiles for it — so pressing Start no longer conjures a surprise/overlapping "remainder" tile.

**Architecture:** One functional change in `assembleScheduleInput` (`@notreclaim/core`): skip any task that has a block with `startedAt != null`. Such a task drops out of the desired schedule, so `applyDesiredSchedule` clears its future auto blocks and keeps its pinned/started ones. `POST /schedule/:id/start` is unchanged.

**Tech Stack:** `@notreclaim/core` (pure scheduling). Vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-notreclaim-review-16c-started-manual-design.md`

---

## Preconditions
- [ ] On branch `feat/review16c-started-manual` (already created).

---

## Task 1: Exclude started tasks from auto-scheduling

**Files:** Modify `packages/core/src/assemble.ts`; Test `packages/core/test/assemble.test.ts`

- [ ] **Step 1: Write failing tests.** In `assemble.test.ts`, append:

```ts
describe('assembleScheduleInput started tasks', () => {
  const NOW = Date.parse('2026-01-05T12:00:00.000Z'); // Monday noon UTC

  it('excludes a task that has a started block from auto-scheduling', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 7_200_000 })], // 2h, has remaining
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: true,
          startsAt: new Date('2026-01-05T12:30:00.000Z'), endsAt: new Date('2026-01-05T13:00:00.000Z'),
          startedAt: new Date('2026-01-05T12:24:00.000Z'),
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeUndefined(); // user-managed → not auto-scheduled
  });

  it('still schedules a task whose blocks are all un-started', async () => {
    const input = await assembleScheduleInput(
      fakeRepos({
        settings: makeSettings({ workingHours: [{ weekday: 1, startMinute: 0, endMinute: 1440 }] as never }),
        categories: [makeCategory()],
        tasks: [makeTask({ id: 't1', durationMs: 3_600_000 })],
        blocks: [makeBlock({
          id: 'b1', taskId: 't1', habitId: null, pinned: false, startedAt: null,
          startsAt: new Date('2026-01-05T09:00:00.000Z'), endsAt: new Date('2026-01-05T09:30:00.000Z'), // finished/past
        })],
      }),
      'u1', NOW,
    );
    expect(input.tasks.find((t) => t.id === 't1')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (first test: the started task is still scheduled).

Run: `npm --workspace @notreclaim/core test -- assemble`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `assemble.ts`, after the `const blocks = …` line (and before/near the `taskCoverageMs` block), add:

```ts
  // A task the user has Started becomes user-managed: stop auto-scheduling it (no surprise
  // "remainder" tiles when Start shrinks its block). Its pinned/started blocks stay; apply
  // clears its stale auto blocks since it drops out of the desired schedule.
  const startedTaskIds = new Set(
    blocks.filter((b) => b.startedAt != null && b.taskId != null).map((b) => b.taskId as string),
  );
```

Then in the `for (const t of allTasks)` loop, add the skip right after the status check:

```ts
    if (!SCHEDULABLE_TASK_STATUSES.includes(t.status)) continue;
    if (startedTaskIds.has(t.id)) continue; // started → user-managed
```

- [ ] **Step 4: Run — expect PASS** (new + all existing assemble tests).

Run: `npm --workspace @notreclaim/core test -- assemble`
Expected: PASS.

- [ ] **Step 5: Full core test + build, then commit.**

Run: `npm --workspace @notreclaim/core test && npm --workspace @notreclaim/core run build`
Expected: all pass; tsc clean.

```bash
git add packages/core/src/assemble.ts packages/core/test/assemble.test.ts
git commit -m "feat(core): a Started task is user-managed — stop auto-scheduling it (no surprise remainder tile)"
```

---

## Task 2: Verify & finish

- [ ] **Step 1: Full suites + build.**
```bash
npm --workspace @notreclaim/core test
npm --workspace @notreclaim/server test
(cd packages/web && npm test)
npm run build
```
Expected: all green; clean. (Core is the only functional change; server/web confirm nothing downstream broke.)

- [ ] **Step 2: Rebuild + restart the API, live-verify via geckodriver.** Rebuild server dist (`npm run build` did) and restart the API. Reproduce the original sequence against the demo (NY tz): create a block spanning now for a task (`POST /schedule`), press Start (`POST /schedule/:id/start`), then confirm via `GET /schedule` that **no new auto block** was created for that task (only the shrunk started block remains), and that the task's previously-existing auto blocks were cleared by the reconcile. Clean up the test block.

- [ ] **Step 3: Update memory** (`project-status.md` + `MEMORY.md`): Review 16c done; the **Review 16 batch (16a tz + 16b overlap + 16c started-manual) is COMPLETE**.

- [ ] **Step 4: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to merge `feat/review16c-started-manual` to `main`.

---

## Self-review notes (reconciled)
- **Spec coverage:** exclude started tasks from auto-scheduling (Task 1); verify the surprise tile is gone (Task 2).
- **Minimal:** one functional change in `assemble.ts`; `apply.ts` already clears a dropped task's future auto blocks and keeps pinned/started ones; Start endpoint untouched.
- **Trade-off documented:** a started task isn't auto-backfilled afterward (user-managed).
