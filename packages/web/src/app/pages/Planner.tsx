import { useMemo, useState, useEffect, useRef } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import type { CalendarEvent, Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useHabitsQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, dayAnchor, rangeLabel, MS_PER_DAY } from '../planner/weekModel';
import { useElementWidth } from '../planner/useElementWidth';
import { useCompactWidth, usePointerCoarse } from '../lib/useMediaQuery';
import { useDragToScheduleSensors, pointerFirstCollision } from '../dnd/sensors';
import { useLivePointerY } from '../dnd/useLivePointerY';
import { dayDropFromOver, draggedTaskId, scheduleDropResult, type DayDropTarget } from '../planner/scheduleDrop';
import { shouldCollapseSheet } from '../planner/dragSheet';
import { Sheet } from '../components/Sheet';
import { DrawerHost } from '../components/DrawerHost';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { UnscheduledWarning } from '../planner/UnscheduledWarning';
import { summarizeUnscheduled } from '../planner/unscheduledSummary';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { EventDrawer } from '../planner/EventDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const settingsQ = useSettingsQuery();
  const zone = settingsQ.data?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  // Visual day boundary: with 180 a column runs 03:00 → 03:00, so 01:30 still shows as "today".
  const dayStartMinute = settingsQ.data?.dayStartMinute ?? 0;
  const [viewStartMs, setViewStartMs] = useState(() => dayAnchor(nowMs, zone, dayStartMinute));
  const [gridRef, gridWidth] = useElementWidth<HTMLDivElement>();
  // Viewport switch, not pane width: the grid pane is only ~640px on a 1280px desktop, so
  // inferring "compact" from gridWidth would put a real desktop on the phone geometry.
  const compact = useCompactWidth();
  // One media-query subscription for the whole page rather than one per tile.
  const coarse = usePointerCoarse();
  const dayCount = daysThatFit(gridWidth, compact);
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
  // On the compact layout the panel is a bottom sheet instead of an inline column; its
  // open/closed state is per-visit, not persisted (the desktop hide toggle stays persisted).
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  // Dropped to a strip while a card is dragged out of the sheet, so the grid below is visible and
  // droppable. Cleared on drag end and on cancel; never persisted.
  const [sheetCollapsed, setSheetCollapsed] = useState(false);

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const tasksQ = useTasksQuery();
  const habitsQ = useHabitsQuery();
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

  // Drag a task card from the side panel / Tasks sheet onto a day column → pinned block at the slot.
  const dragSensors = useDragToScheduleSensors();
  const [taskDrop, setTaskDrop] = useState<DayDropTarget | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const draggingTask = (tasksQ.data ?? []).find((t) => t.id === draggingTaskId) ?? null;
  // Armed for the duration of a card drag. See useLivePointerY for why dnd-kit's own
  // activatorEvent + delta cannot be trusted once a droppable is entered.
  const livePointerY = useLivePointerY(draggingTaskId !== null);

  const targetFrom = (e: DragMoveEvent | DragEndEvent): DayDropTarget | null => dayDropFromOver({
    overData: e.over?.data.current ?? null,
    overRect: e.over?.rect ?? null,
    // Live pointer only. There is no drag-start-frame fallback: reconstructing the pointer from
    // activatorEvent + delta is exactly the poisoned value the live listener exists to replace, so
    // "no move seen yet" must mean "no target yet" rather than a wrong one. See useLivePointerY.
    pointerY: livePointerY.current,
  });

  const onDragStart = (e: DragStartEvent) => {
    const taskId = draggedTaskId(e.active.data.current);
    setDraggingTaskId(taskId);
    if (shouldCollapseSheet({ compact, sheetOpen: taskSheetOpen, isTaskDrag: taskId !== null })) setSheetCollapsed(true);
  };
  const onDragMove = (e: DragMoveEvent) => setTaskDrop(draggedTaskId(e.active.data.current) ? targetFrom(e) : null);
  const endDrag = () => { setTaskDrop(null); setDraggingTaskId(null); setSheetCollapsed(false); };
  const onDragEnd = (e: DragEndEvent) => {
    // Decide first, clear second: `endDrag` disarms the live pointer listener, so the reading the
    // drop depends on has to be taken while the drag is still live.
    const drop = scheduleDropResult({
      activeData: e.active.data.current,
      overData: e.over?.data.current ?? null,
      overRect: e.over?.rect ?? null,
      pointerY: livePointerY.current,
      tasks: tasksQ.data ?? [],
    });
    endDrag();
    if (drop) createBlock.mutate(drop);
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

  // The preview query lives under the ['schedule'] root, so every replan / ws schedule event
  // invalidates it too — the banner clears itself once everything fits again.
  const unscheduledEntries = useMemo(
    () => summarizeUnscheduled(preview.data?.unscheduled, tasksQ.data, habitsQ.data),
    [preview.data, tasksQ.data, habitsQ.data],
  );

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

  const panelProps = {
    tasks: tasksQ.data ?? [],
    preview: preview.data,
    nowMs,
    coarse,
    onComplete: onCompleteTask,
    // Compact: the Tasks sheet and the drawer are both z-50 modal sheets, and two stacked sheets
    // would trap focus in the wrong one — close the sheet as we hand over.
    onEdit: (t: Task) => {
      if (compact) {
        // Park focus on the toggle before the swap. The drawer's Sheet records the focused element
        // during its render phase, and that is still the ✎ inside the Tasks sheet we are about to
        // unmount — a detached node fails the Sheet's isConnected guard, so closing the drawer
        // would strand focus on <body>. The toggle outlives both sheets.
        document.querySelector<HTMLElement>('[data-testid="panel-sheet-toggle"]')?.focus();
        setTaskSheetOpen(false);
      }
      openTaskDrawer(t.id);
    },
    onDelete: onDeleteTask,
  };

  // `h-full` hands the shell's content height down the flex chain so the hours-scroll can size
  // itself from real layout instead of a hard-coded chrome constant. AppShell's shell-content
  // already reserves the fixed tab bar in its padding, so nothing here has to know about it.
  return (
    <DndContext
      sensors={dragSensors}
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
    <div className="flex h-full min-h-0 gap-3 p-2 md:p-4">
      <div ref={gridRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        {isLoading && <div className="shrink-0 p-2 text-sm text-gray-500">Loading your days…</div>}
        <UnscheduledWarning entries={unscheduledEntries} />
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={rangeLabel(days, zone)}
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
          onEditTask={openTaskDrawer}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          taskDrop={taskDrop}
          accents={accents}
          compact={compact}
          coarse={coarse}
          // Compact: the toggle reflects the sheet, so `panelHidden` (its aria-expanded source)
          // must track the sheet rather than the persisted desktop hide flag.
          panelHidden={compact ? !taskSheetOpen : panelHidden}
          onTogglePanel={() => (compact ? setTaskSheetOpen((o) => !o) : setPanelHidden((h) => !h))}
        />
        {replan.isError && <p className="mt-2 shrink-0 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      {/* Below md the panel never renders inline — it becomes the bottom sheet below. */}
      {!compact && !panelHidden && <PlannerTaskPanel {...panelProps} />}
      {compact && taskSheetOpen && (
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)} collapsed={sheetCollapsed}>
          <PlannerTaskPanel {...panelProps} compact />
        </Sheet>
      )}
      {editing && (
        <DrawerHost compact={compact} label="Edit task" onClose={() => setEditingId(null)} desktopClass="fixed right-3 top-[84px] z-50">
          <TaskDrawer
            task={editing} compact={compact} saving={updateTask.isPending}
            error={updateTask.error instanceof ApiError ? updateTask.error : null}
            onSave={(patch) => updateTask.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </DrawerHost>
      )}
      {editingEvent && (
        <DrawerHost compact={compact} label="Edit event" onClose={() => setEditingEventId(null)} desktopClass="fixed right-3 top-[84px] z-50">
          {/* Key on the event's times: a background refetch (or a drag) that moves the event
              remounts the drawer so its fields re-seed instead of holding stale values. */}
          <EventDrawer
            key={`${editingEvent.id}:${editingEvent.startsAt}:${editingEvent.endsAt}`}
            event={editingEvent} compact={compact} zone={zone} onClose={() => setEditingEventId(null)}
          />
        </DrawerHost>
      )}
    </div>
    <DragOverlay>
      {draggingTask ? (
        <div
          data-testid="schedule-drag-overlay"
          className="rounded-[10px] border border-line bg-card px-3 py-2 text-[14px] font-bold text-ink shadow-pop"
        >
          {draggingTask.title}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
