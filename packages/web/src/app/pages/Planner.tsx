import { useMemo, useState } from 'react';
import type { Task } from '../../api/types';
import { ApiError } from '../../api/client';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation, useUpdateScheduledBlockMutation, useDeleteScheduledBlockMutation, useDeleteCalendarEventMutation, useTasksQuery, useCategoriesQuery, useUpdateTaskMutation, useDeleteTaskMutation } from '../../api/queries';
import { startOfWeek, dayColumns, addWeeks } from '../planner/weekModel';
import { WeekGrid } from '../planner/WeekGrid';
import { PlannerTaskPanel } from '../planner/PlannerTaskPanel';
import { TaskDrawer } from '../tasks/TaskDrawer';
import { labelBlocksWithSubtasks } from '../planner/blockLabels';

function weekLabel(days: number[]): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(days[0]!)} – ${fmt(days[6]!)}`;
}

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const [weekStartMs, setWeekStartMs] = useState(() => startOfWeek(nowMs));
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(addWeeks(weekStartMs, 1)).toISOString();

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const tasksQ = useTasksQuery();
  const categoriesQ = useCategoriesQuery();
  const replan = useReplanMutation();
  const updateBlock = useUpdateScheduledBlockMutation();
  const deleteBlock = useDeleteScheduledBlockMutation();
  const deleteEvent = useDeleteCalendarEventMutation();
  const updateTask = useUpdateTaskMutation();
  const deleteTask = useDeleteTaskMutation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = (tasksQ.data ?? []).find((t) => t.id === editingId) ?? null;

  const onCompleteTask = (t: Task) => updateTask.mutate({ id: t.id, patch: { status: t.status === 'completed' ? 'pending' : 'completed' } });
  const onDeleteTask = (t: Task) => deleteTask.mutate(t.id, { onSuccess: () => { if (editingId === t.id) setEditingId(null); } });

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
      <div className="flex-1">
        {isLoading && <div className="p-2 text-sm text-gray-500">Loading your week…</div>}
        <WeekGrid
          days={days}
          nowMs={nowMs}
          weekLabel={weekLabel(days)}
          blocks={labeledBlocks}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setWeekStartMs((ms) => addWeeks(ms, -1))}
          onNext={() => setWeekStartMs((ms) => addWeeks(ms, 1))}
          onToday={() => setWeekStartMs(startOfWeek(now()))}
          onReplan={() => replan.mutate()}
          onCommit={(id, patch) => updateBlock.mutate({ id, patch })}
          onDeleteBlock={(id) => deleteBlock.mutate(id)}
          onDeleteEvent={(id) => deleteEvent.mutate(id)}
          accents={accents}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      <PlannerTaskPanel
        tasks={tasksQ.data ?? []}
        preview={preview.data}
        nowMs={nowMs}
        onComplete={onCompleteTask}
        onEdit={(t) => setEditingId(t.id)}
        onDelete={onDeleteTask}
      />
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
    </div>
  );
}
