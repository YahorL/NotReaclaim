import { useMemo, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragOverlay, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from '@dnd-kit/core';
import type { CalendarEvent, Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useUpdateCalendarEventMutation, useCreateScheduledBlockMutation, useTasksQuery, useHabitsQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation, useSettingsQuery, useStopBlockMutation } from '../../api/queries';
import { dayColumns, daysThatFit, shiftDays, dayAnchor, rangeLabel, weekdayLabel } from '../planner/weekModel';
import { toIso } from '../lib/time';
import { useTimezone } from '../settings/useTimezone';
import { useElementWidth } from '../planner/useElementWidth';
import { useCompactWidth, usePointerCoarse } from '../lib/useMediaQuery';
import { useDragToScheduleSensors, pointerFirstCollision } from '../dnd/sensors';
import { makeAnnouncements, POINTER_ONLY_DRAG_INSTRUCTIONS } from '../dnd/announcements';
import { useLivePointerY } from '../dnd/useLivePointerY';
import { dayDropFromOver, dayIndexFromDroppableId, draggedTaskId, panelTaskDraggableId, scheduleDropResult, type DayDropTarget } from '../planner/scheduleDrop';
import { shouldCollapseSheet } from '../planner/dragSheet';
import { Sheet } from '../components/Sheet';
import { DrawerHost } from '../components/DrawerHost';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel, type PanelTab } from '../planner/PlannerTaskPanel';
import { UnscheduledCard } from '../planner/UnscheduledCard';
import { NextUpCard } from '../planner/NextUpCard';
import { summarizeUnscheduled } from '../planner/unscheduledSummary';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { EventDrawer } from '../planner/EventDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';
import { BlockDetailCard, type BlockDetail } from '../planner/BlockDetailCard';
import { classifyBlock } from '../planner/weekModel';

const DRAWER_DESKTOP_CLASS = 'fixed right-3 top-[120px] z-50';

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const settingsQ = useSettingsQuery();
  const zone = useTimezone();
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
  const rangeFromIso = toIso(viewStartMs);
  // The end of the last column, by wall-clock days: a 25h fall-back day is not cut an hour short.
  const rangeToIso = toIso(shiftDays(viewStartMs, dayCount, zone));
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
  // Lifted so the summary card's "+N more" can switch the panel to All tasks.
  const [panelTab, setPanelTab] = useState<PanelTab>('priorities');
  const showAllTasks = () => {
    setPanelTab('tasks');
    if (compact) setTaskSheetOpen(true);
    else setPanelHidden(false);
  };

  const schedule = useScheduleQuery(rangeFromIso, rangeToIso);
  const calendar = useCalendarEventsQuery(rangeFromIso, rangeToIso);
  const preview = useSchedulePreviewQuery();
  const tasksQ = useTasksQuery();
  // Memoised so the fallback [] keeps one identity while loading: several memos below depend on it.
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
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
  const stopBlock = useStopBlockMutation();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = tasks.find((t) => t.id === editingId) ?? null;
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
  const draggingTask = tasks.find((t) => t.id === draggingTaskId) ?? null;
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
      tasks,
    });
    endDrag();
    if (drop) createBlock.mutate(drop);
  };

  // Without this a screen reader hears the raw draggable id ("panel-task:cm4x8…") and dnd-kit's
  // stock instructions, which promise a space-bar lift this pointer-only surface cannot honour.
  const dragAccessibility = useMemo(() => ({
    screenReaderInstructions: POINTER_ONLY_DRAG_INSTRUCTIONS,
    announcements: makeAnnouncements(
      (id) => tasks.find((t) => panelTaskDraggableId(t.id) === id)?.title ?? null,
      (id) => {
        const i = dayIndexFromDroppableId(id);
        const day = i === null ? undefined : days[i];
        return day === undefined ? null : weekdayLabel(day, zone);
      },
    ),
  }), [tasks, days, zone]);

  const labeledBlocks = useMemo(
    () => labelBlocksWithSubtasks(schedule.data ?? [], tasks),
    [schedule.data, tasks],
  );

  // Selection (spec §5.4): `b:<id>` / `e:<id>`. md+ only — below md a tap opens the drawer.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // The selection came from the keyboard: the card takes focus (and hands it back on close).
  const [selectedByKeyboard, setSelectedByKeyboard] = useState(false);
  const selectedDetail = useMemo((): BlockDetail | null => {
    if (!selectedKey) return null;
    if (selectedKey.startsWith('b:')) {
      const b = labeledBlocks.find((x) => `b:${x.id}` === selectedKey);
      if (!b) return null;
      const cls = classifyBlock(b);
      const endMs = Date.parse(b.endsAt);
      return { key: selectedKey, kind: cls.kind, source: null, title: b.title, startMs: Date.parse(b.startsAt), endMs,
        pinned: cls.pinned, started: b.startedAt != null, running: b.startedAt != null && endMs > nowMs, taskId: b.taskId, event: null };
    }
    const ev = (calendar.data ?? []).find((x) => `e:${x.id}` === selectedKey);
    if (!ev) return null;
    return { key: selectedKey, kind: ev.kind === 'blocked' ? 'blocked' : 'meeting', source: ev.source, title: ev.title,
      startMs: Date.parse(ev.startsAt), endMs: Date.parse(ev.endsAt), pinned: false, started: false, running: false, taskId: null, event: ev };
  }, [selectedKey, labeledBlocks, calendar.data, nowMs]);
  // The selected block left the data (deleted, paged away, replanned out): drop the selection.
  useEffect(() => {
    if (selectedKey && !selectedDetail && !schedule.isFetching && !calendar.isFetching) setSelectedKey(null);
  }, [selectedKey, selectedDetail, schedule.isFetching, calendar.isFetching]);
  const closeDetail = () => {
    const key = selectedKey;
    const focusInCard = document.activeElement?.closest('[data-testid="block-detail-card"]') != null;
    setSelectedKey(null);
    // Back to the block the card described, when the card held focus.
    if (key && focusInCard) {
      document.querySelector<HTMLElement>(`[data-block-key="${key}"] [data-testid="block-body"]`)?.focus();
    }
  };
  // Escape deselects — unless something above the planner (a dialog, a sheet, the create popover)
  // owns that Escape.
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"],[data-testid="create-popover"]')) return;
      closeDetail();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Build accent map: taskId → hex color (only for tasks whose category has a non-null color)
  const accents = useMemo<Record<string, string>>(() => {
    const cats = categoriesQ.data ?? [];
    const colorById = new Map(cats.filter((c) => c.color).map((c) => [c.id, c.color!]));
    const result: Record<string, string> = {};
    for (const task of tasks) {
      const color = task.categoryId ? colorById.get(task.categoryId) : undefined;
      if (color !== undefined) result[task.id] = color;
    }
    return result;
  }, [tasks, categoriesQ.data]);

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
        <p className="mb-3 text-danger">Couldn't load the schedule.</p>
        <button
          onClick={() => { void schedule.refetch(); void calendar.refetch(); void preview.refetch(); }}
          className="btn-glass h-10 rounded-pill px-4 text-[14px]"
        >
          Retry
        </button>
      </div>
    );
  }

  const panelProps = {
    tasks,
    preview: preview.data,
    nowMs,
    zone,
    coarse,
    tab: panelTab,
    onTabChange: setPanelTab,
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

  const selectedTask = selectedDetail?.taskId ? tasks.find((t) => t.id === selectedDetail.taskId) ?? null : null;
  const selectedBlockId = selectedDetail && !selectedDetail.event ? selectedDetail.key.slice(2) : null;
  const detailCard = !compact && selectedDetail ? (
    <BlockDetailCard
      detail={selectedDetail}
      zone={zone}
      task={selectedTask}
      autoFocus={selectedByKeyboard}
      onClose={closeDetail}
      onOpenTask={openTaskDrawer}
      onOpenEvent={openEventDrawer}
      onOpenHabits={() => navigate('/habits')}
      onUnpin={selectedBlockId ? () => updateBlock.mutate({ id: selectedBlockId, patch: { pinned: false } }) : undefined}
      onStop={selectedBlockId ? () => stopBlock.mutate(selectedBlockId) : undefined}
      onDelete={() => {
        if (selectedBlockId) deleteBlock.mutate(selectedBlockId);
        else if (selectedDetail.event) deleteEvent.mutate(selectedDetail.event.id);
        setSelectedKey(null);
      }}
    />
  ) : null;

  // `h-full` hands the shell's content height down the flex chain so the hours-scroll can size
  // itself from real layout instead of a hard-coded chrome constant. AppShell's shell-content
  // already reserves the fixed tab bar in its padding, so nothing here has to know about it.
  return (
    <DndContext
      sensors={dragSensors}
      accessibility={dragAccessibility}
      collisionDetection={pointerFirstCollision}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={endDrag}
    >
    <div className={`flex h-full min-h-0 flex-col ${compact ? 'gap-2 p-2' : 'gap-5 px-1 pb-1'}`}>
      {/* Summary row: same split as the grid/panel row below (the Next-up card is the panel's width).
          Compact: the summary card only — the mobile top bar carries Now/Next. */}
      <div data-testid="planner-summary" className={`flex shrink-0 ${compact ? 'flex-col' : 'gap-5'}`}>
        <UnscheduledCard
          className="min-w-0 flex-1"
          entries={unscheduledEntries}
          compact={compact}
          onReplan={() => replan.mutate()}
          replanPending={replan.isPending}
          onShowAll={showAllTasks}
        />
        {!compact && <NextUpCard now={now} className="w-[330px] shrink-0" />}
      </div>
      {replan.isError && <p className="-mt-2 shrink-0 px-1 text-[13px] text-danger">Re-plan failed. Try again.</p>}
    <div className={`flex min-h-0 flex-1 ${compact ? 'gap-2' : 'gap-5'}`}>
      <div ref={gridRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Panel hidden: the card floats over the grid instead of taking a column — narrowing the
            grid would change the day count and could page the selected block out of view. */}
        {!compact && panelHidden && detailCard && (
          <div className="absolute bottom-4 right-4 z-20 w-[330px] rounded-panel shadow-lift">{detailCard}</div>
        )}
        {isLoading && <div className="shrink-0 p-2 text-sm text-fg-2">Loading your days…</div>}
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={rangeLabel(days, zone)}
          blocks={labeledBlocks}
          events={calendar.data ?? []}
          onPrev={() => setViewStartMs((ms) => shiftDays(ms, -dayCount, zone))}
          onNext={() => setViewStartMs((ms) => shiftDays(ms, dayCount, zone))}
          onToday={() => setViewStartMs(dayAnchor(now(), zone, dayStartMinute))}
          zone={zone}
          dayStartMinute={dayStartMinute}
          onCommit={(id, patch) => updateBlock.mutate({ id, patch })}
          onDeleteBlock={(id) => deleteBlock.mutate(id)}
          onCommitEvent={(id, patch) => updateEvent.mutate({ id, ...patch })}
          onEditEvent={openEventDrawer}
          onEditTask={openTaskDrawer}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          taskDrop={taskDrop}
          selectedKey={selectedKey}
          onSelect={(key, { keyboard }) => { setSelectedKey(key); setSelectedByKeyboard(keyboard); }}
          accents={accents}
          compact={compact}
          coarse={coarse}
          // Compact: the toggle reflects the sheet, so `panelHidden` (its aria-expanded source)
          // must track the sheet rather than the persisted desktop hide flag.
          panelHidden={compact ? !taskSheetOpen : panelHidden}
          onTogglePanel={() => (compact ? setTaskSheetOpen((o) => !o) : setPanelHidden((h) => !h))}
        />
      </div>
      {/* Below md the panel never renders inline — it becomes the bottom sheet below. */}
      {/* Side column: the detail card atop the task panel. */}
      {!compact && !panelHidden && (
        <div className="flex min-h-0 w-[330px] shrink-0 flex-col gap-5">
          {detailCard}
          <PlannerTaskPanel {...panelProps} />
        </div>
      )}
    </div>
      {compact && taskSheetOpen && (
        <Sheet label="Tasks" onClose={() => setTaskSheetOpen(false)} collapsed={sheetCollapsed}>
          <PlannerTaskPanel {...panelProps} compact />
        </Sheet>
      )}
      {editing && (
        <DrawerHost compact={compact} label="Edit task" onClose={() => setEditingId(null)} desktopClass={DRAWER_DESKTOP_CLASS}>
          {/* Keyed by id: the drawer seeds its form once at mount, so switching the edited task
              while it stays mounted (keyboard Edit, a coarse-pointer tile tap at md+) must remount it. */}
          <TaskDrawer
            key={editing.id}
            task={editing} zone={zone} compact={compact} saving={updateTask.isPending}
            error={updateTask.error instanceof ApiError ? updateTask.error : null}
            onSave={(patch) => updateTask.mutate({ id: editing.id, patch }, { onSuccess: () => setEditingId(null) })}
            onCancel={() => setEditingId(null)}
          />
        </DrawerHost>
      )}
      {editingEvent && (
        <DrawerHost compact={compact} label="Edit event" onClose={() => setEditingEventId(null)} desktopClass={DRAWER_DESKTOP_CLASS}>
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
          // Glass card tilted like a picked-up tile; the accent ring says "drop me on the grid".
          className="glass-dialog rotate-[-1.5deg] rounded-card px-3.5 py-2.5 text-[14px] font-medium text-fg shadow-lift ring-[1.5px] ring-accent/70"
        >
          {draggingTask.title}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
  );
}
