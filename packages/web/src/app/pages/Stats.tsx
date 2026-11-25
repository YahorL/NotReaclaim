import { useMemo } from 'react';
import { useSchedulePreviewQuery, useCalendarEventsQuery, useTasksQuery } from '../../api/queries';
import { startOfWeek, dayColumns, addWeeks } from '../planner/weekModel';
import {
  hoursByDay, summary, meetingCount, taskCompletion, donutSegments, formatHoursNumber,
} from '../stats/statsModel';
import { StatCard } from '../stats/StatCard';
import { useTimezone } from '../settings/useTimezone';
import { HoursByDayChart } from '../stats/HoursByDayChart';
import { TimeSplitDonut } from '../stats/TimeSplitDonut';

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function Stats({ now = () => Date.now() }: { now?: () => number }) {
  // The week and its days are the user's settings-zone week (Mon 00:00 → next Mon 00:00 there).
  const zone = useTimezone();
  const weekStartMs = startOfWeek(now(), zone);
  const days = useMemo(() => dayColumns(weekStartMs, 7, zone), [weekStartMs, zone]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(addWeeks(weekStartMs, 1, zone)).toISOString();

  const preview = useSchedulePreviewQuery();
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const tasksQ = useTasksQuery();

  const isLoading = preview.isLoading || calendar.isLoading || tasksQ.isLoading;
  const isError = preview.isError || calendar.isError || tasksQ.isError;

  const perDay = useMemo(() => hoursByDay(days, preview.data, calendar.data ?? [], zone), [days, preview.data, calendar.data, zone]);
  const sum = useMemo(() => summary(perDay), [perDay]);
  const mc = meetingCount(days, calendar.data ?? [], zone);
  const comp = taskCompletion(tasksQ.data ?? []);
  const segs = donutSegments(sum);

  if (isError) {
    return (
      <div className="px-4 pt-4 md:px-1">
        <p className="mb-3 text-danger">Couldn't load your stats.</p>
        <button
          type="button"
          onClick={() => { void preview.refetch(); void calendar.refetch(); void tasksQ.refetch(); }}
          className="btn-glass rounded-pill px-4 py-2 text-[14px]"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="px-4 pt-4 text-sm text-fg-2 md:px-1">Loading…</div>;
  }

  if (sum.totalMs === 0 && comp.total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-2">
        <div className="text-[20px] font-medium text-fg">Nothing scheduled yet</div>
        <div className="text-[15px]">Add tasks or habits and they'll show up here.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-6 pt-4 md:px-1 md:pt-0">
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 md:flex">
        <StatCard label="Total scheduled" value={formatHoursNumber(sum.totalMs)} unit="h" sub="this week" />
        <StatCard label="Task time" value={formatHoursNumber(sum.taskMs)} unit="h" sub="auto-scheduled" delayMs={60} />
        <StatCard label="In meetings" value={formatHoursNumber(sum.meetingMs)} unit="h" sub={`${mc} ${mc === 1 ? 'event' : 'events'}`} swatch="meeting" delayMs={120} />
        <StatCard label="Tasks done" value={String(comp.done)} unit={` / ${comp.total}`} sub={`${comp.pct}% complete`} progressPct={comp.pct} delayMs={180} />
      </section>
      <div className="flex flex-col items-stretch gap-5 md:flex-row md:flex-wrap">
        <HoursByDayChart perDay={perDay} shortLabels={DAY_SHORT} longLabels={DAY_LONG} />
        <TimeSplitDonut segments={segs} totalMs={sum.totalMs} />
      </div>
    </div>
  );
}
