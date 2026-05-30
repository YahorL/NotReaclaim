import { useMemo, useState } from 'react';
import { useScheduleQuery, useCalendarEventsQuery, useSchedulePreviewQuery, useReplanMutation } from '../../api/queries';
import { startOfWeek, dayColumns } from '../planner/weekModel';
import { WeekGrid } from '../planner/WeekGrid';
import { AtRiskPanel } from '../planner/AtRiskPanel';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function weekLabel(days: number[]): string {
  const fmt = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${fmt(days[0]!)} – ${fmt(days[6]!)}`;
}

export function Planner({ now = () => Date.now() }: { now?: () => number }) {
  const nowMs = now();
  const [weekStartMs, setWeekStartMs] = useState(() => startOfWeek(nowMs));
  const days = useMemo(() => dayColumns(weekStartMs), [weekStartMs]);
  const fromIso = new Date(weekStartMs).toISOString();
  const toIso = new Date(weekStartMs + 7 * MS_PER_DAY).toISOString();

  const schedule = useScheduleQuery(fromIso, toIso);
  const calendar = useCalendarEventsQuery(fromIso, toIso);
  const preview = useSchedulePreviewQuery();
  const replan = useReplanMutation();

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
          blocks={schedule.data ?? []}
          events={calendar.data ?? []}
          replanPending={replan.isPending}
          onPrev={() => setWeekStartMs(weekStartMs - 7 * MS_PER_DAY)}
          onNext={() => setWeekStartMs(weekStartMs + 7 * MS_PER_DAY)}
          onToday={() => setWeekStartMs(startOfWeek(now()))}
          onReplan={() => replan.mutate()}
        />
        {replan.isError && <p className="mt-2 text-sm text-red-600">Re-plan failed. Try again.</p>}
      </div>
      <AtRiskPanel items={preview.data?.unscheduled ?? []} />
    </div>
  );
}
