import { useMemo, useState, useEffect, useRef } from 'react';
import type { CalendarEvent, Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, dayAnchor, clampToWindow, MS_PER_DAY, WINDOW_START_MIN, WINDOW_END_MIN } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { EventDrawer } from '../planner/EventDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';

function weekLabel(days: number[], zone = 'UTC'): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: zone });
  return `${fmt(days[0]!)} – ${fmt(days[days.length - 1]!)}`;
}

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const settingsQ = useSettingsQuery();
  const zone = settingsQ.data?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  // Visual day boundary: with 180 a column runs 03:00 → 03:00, so 01:30 still shows as "today".
  const dayStartMinute = settingsQ.data?.dayStartMinute ?? 0;
  const [viewStartMs, setViewStartMs] = useState(() => dayAnchor(nowMs, zone, dayStartMinute));
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  const dayCount = daysThatFit(gridWidth);
  const days = useMemo(() => dayColumns(viewStartMs, dayCount, zone, dayStartMinute), [viewStartMs, dayCount, zone, dayStartMinute]);
  const fromIso = new Date(viewStartMs).toISOString();
  const toIso = new Date(viewStartMs + dayCount * MS_PER_DAY).toISOString();
  // Settings land after the first render — re-anchor the view when the zone or the day start
  // arrives (or the user changes either), otherwise the columns keep the pre-settings anchor.
  const prevAnchorRef = useRef(`${zone}|${dayStartMinute}`);
  useEffect(() => {
    const key = `${zone}|${dayStartMinute}`;
    if (key !== prevAnchorRef.current) {
      prevAnchorRef.current = key;
      setViewStartMs(dayAnchor(now(), zone, dayStartMinute));
    }
  }, [zone, dayStartMinute, now]);

  const [panelHidden, setPanelHidden] = useState(() => {
    try { return localStorage.getItem('nr.plannerPanelHidden') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('nr.plannerPanelHidden', panelHidden ? '1' : '0'); } catch { /* ignore */ }
  }, [panelHidden]);

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const tasksQ = useTasksQuery();
  const categoriesQ = useCategoriesQuery();
  const replan = useReplanMutation();
  const updateBlock = useUpdateScheduledBlockMutation();
  const deleteBlock = useDeleteScheduledBlockMutation();
  const deleteEvent = useDeleteCalendarEventMutation();
  const updateEvent = useUpdateCalendarEventMutation();
  const updateTask = useUpdateTaskMutation();
  const deleteTask = useDeleteTaskMutation();
  const createBlock = useCreateScheduledBlockMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = (tasksQ.data ?? []).find((t) => t.id === editingId) ?? null;
  // Only one drawer at a time — they share the same fixed slot on the right. The event is looked
  // up by id (like the task above) so the drawer disappears when the event is deleted elsewhere.
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const editingEvent = (calendar.data ?? []).find((e) => e.id === editingEventId) ?? null;
  const openTaskDrawer = (id: string) => { setEditingEventId(null); setEditingId(id); };
  const openEventDrawer = (ev: CalendarEvent) => { setEditingId(null); setEditingEventId(ev.id); };

  const onCompleteTask = (t: Task) => updateTask.mutate({ id: t.id, patch: { status: t.status === 'completed' ? 'pending' : 'completed' } });
  const onDeleteTask = (t: Task) => deleteTask.mutate(t.id, { onSuccess: () => { if (editingId === t.id) setEditingId(null); } });

  // Drag a task card from the side panel onto a day column → create a pinned block at the slot.
  const onScheduleTaskAt = (taskId: string, dayStartMs: number, startMin: number) => {
    const task = (tasksQ.data ?? []).find((t) => t.id === taskId);
    if (!task) return;
    const windowSpan = WINDOW_END_MIN - WINDOW_START_MIN;
    const durationMin = Math.min(Math.max(15, Math.round(task.durationMs / 60_000)), windowSpan);
    const { startMin: s, endMin: e } = clampToWindow(startMin, durationMin);
    createBlock.mutate({
      taskId,
      startsAt: new Date(dayStartMs + s * 60_000).toISOString(),
      endsAt: new Date(dayStartMs + e * 60_000).toISOString(),
    });
  };

  const labeledBlocks = useMemo(
    () => labelBlocksWithSubtasks(schedule.data ?? [], tasksQ.data ?? []),
    [schedule.data, tasksQ.data],
  );

  // Build accent map: taskId → hex color (only for tasks whose category has a non-null color)
  const accents = useMemo<Record<string, string>>(() => {
    const cats = categoriesQ.data ?? [];
    const colorById = new Map(cats.filter((c) => c.color).map((c) => [c.id, c.color!]));
    const result: Record<string, string> = {};
    for (const task of tasksQ.data ?? []) {
      if (task.categoryId && colorById.has(task.categoryId)) {
        result[task.id] = colorById.get(task.categoryId)!;
      }
    }
    return result;
  }, [tasksQ.data, categoriesQ.data]);

  const isLoading = schedule.isLoading || calendar.isLoading || preview.isLoading;
  const isError = schedule.isError || calendar.isError || preview.isError;

  if (isError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn't load the schedule.</p>
        <button
          onClick={() => { void schedule.refetch(); void calendar.refetch(); void preview.refetch(); }}
          className="rounded border border-gray-300 px-3 py-1"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 p-4">
      <div ref={gridRef} className="min-w-0 flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your days…</div>}
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days, zone)}
          blocks={labeledBlocks}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setViewStartMs((ms) => shiftDays(ms, -dayCount, zone))}
          onNext={() => setViewStartMs((ms) => shiftDays(ms, dayCount, zone))}
          onToday={() => setViewStartMs(dayAnchor(now(), zone, dayStartMinute))}
          zone={zone}
          dayStartMinute={dayStartMinute}
          onReplan={() => replan.mutate()}
          onCommit={(id, patch) => updateBlock.mutate({ id, patch })}
          onDeleteBlock={(id) => deleteBlock.mutate(id)}
          onCommitEvent={(id, patch) => updateEvent.mutate({ id, ...patch })}
          onEditEvent={openEventDrawer}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          onScheduleTaskAt={onScheduleTaskAt}
          accents={accents}
          panelHidden={panelHidden}
          onTogglePanel={() => setPanelHidden((h) => !h)}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      {!panelHidden && (
        <PlannerTaskPanel
          tasks={tasksQ.data ?? []}
          preview={preview.data}
          nowMs={nowMs}
          onComplete={onCompleteTask}
          onEdit={(t) => openTaskDrawer(t.id)}
          onDelete={onDeleteTask}
        />
      )}
      {editing && (
        <div className="fixed right-3 top-[84px] z-40">
          <TaskDrawer
            task={editing} saving={updateTask.isPending}
            error={updateTask.error instanceof ApiError ? updateTask.error : null}
            onSave={(patch) => updateTask.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
      {editingEvent && (
        <div className="fixed right-3 top-[84px] z-40">
          {/* Key on the event's times: a background refetch (or a drag) that moves the event
              remounts the drawer so its fields re-seed instead of holding stale values. */}
          <EventDrawer
            key={`${editingEvent.id}:${editingEvent.startsAt}:${editingEvent.endsAt}`}
            event={editingEvent} zone={zone} onClose={() => setEditingEventId(null)}
          />
        </div>
      )}
    </div>
  );
}
