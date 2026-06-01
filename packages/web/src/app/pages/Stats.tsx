import { useMemo } from 'react';
import { useSchedulePreviewQuery, useCalendarEventsQuery, useTasksQuery } from '../../api/queries';
import { startOfWeek, dayColumns, addWeeks } from '../planner/weekModel';
import {
  hoursByDay, summary, meetingCount, taskCompletion, donutSegments, formatHours,
} from '../stats/statsModel';
import { StatCard } from '../stats/StatCard';
import { HoursByDayChart } from '../stats/HoursByDayChart';
import { TimeSplitDonut } from '../stats/TimeSplitDonut';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function Stats({ now = () => Date.now() }: { now?: () => number }) {
  const weekStartMs = startOfWeek(now());
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(addWeeks(weekStartMs, 1)).toISOString();

  const preview = useSchedulePreviewQuery();
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const tasksQ = useTasksQuery();

  const isLoading = preview.isLoading || calendar.isLoading || tasksQ.isLoading;
  const isError = preview.isError || calendar.isError || tasksQ.isError;

  const perDay = useMemo(() => hoursByDay(days, preview.data, calendar.data ?? []), [days, preview.data, calendar.data]);
  const sum = useMemo(() => summary(perDay), [perDay]);
  const mc = meetingCount(days, calendar.data ?? []);
  const comp = taskCompletion(tasksQ.data ?? []);
  const segs = donutSegments(sum);

  if (isError) {
    return (
      <div className="p-6">
        <p className="mb-2 text-crit">Couldn't load your stats.</p>
        <button
          type="button"
          onClick={() => { void preview.refetch(); void calendar.refetch(); void tasksQ.refetch(); }}
          className="rounded border border-line px-3 py-1"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="px-[30px] pt-4 text-sm text-inkSoft">Loading…</div>;
  }

  if (sum.totalMs === 0 && comp.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-inkSoft">
        <div className="text-[19px] font-bold">Nothing scheduled yet</div>
        <div className="text-[15px]">Add tasks or habits and they'll show up here.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[18px] px-[30px] pb-10 pt-1">
      <div className="flex gap-[18px]">
        <StatCard label="Total scheduled" value={formatHours(sum.totalMs)} sub="this week" accent="text-indigo" />
        <StatCard label="Task time" value={formatHours(sum.taskMs)} sub="auto-scheduled" accent="text-kind-taskText" />
        <StatCard label="In meetings" value={formatHours(sum.meetingMs)} sub={`${mc} events`} accent="text-crit" />
        <StatCard label="Tasks done" value={`${comp.done} / ${comp.total}`} sub={`${comp.pct}% complete`} accent="text-low" />
      </div>
      <div className="flex items-stretch gap-[18px]">
        <HoursByDayChart perDay={perDay} dayLabels={DAY_LABELS} />
        <TimeSplitDonut segments={segs} totalMs={sum.totalMs} />
      </div>
    </div>
  );
}
