import { useMemo, useState } from 'react';
import type { Habit } from '../../api/types';
import { ApiError } from '../../api/client';
import { useHabitsQuery, useCreateHabitMutation, useUpdateHabitMutation, useDeleteHabitMutation, useSchedulePreviewQuery } from '../../api/queries';
import { missedByHabit } from '../planner/unscheduledSummary';
import { QuickAdd } from '../components/QuickAdd';
import { HabitRow } from '../habits/HabitRow';
import { HabitDrawer } from '../habits/HabitDrawer';
import { DrawerHost } from '../components/DrawerHost';
import { useCompactWidth } from '../lib/useMediaQuery';
import { saveErrorText } from '../lib/saveError';
import { defaultQuickAddInput } from '../habits/habitForm';
import { habitSummary } from '../habits/habitSummary';

export function Habits() {
  const habitsQ = useHabitsQuery();
  const createM = useCreateHabitMutation();
  const updateM = useUpdateHabitMutation();
  const deleteM = useDeleteHabitMutation();
  const [editing, setEditing] = useState<Habit | null>(null);
  const compact = useCompactWidth();

  const habits = habitsQ.data ?? [];
  // Same preview the planner banner reads (shared query key, no extra endpoint): habits whose
  // occurrences the engine could not place get the ⚠ chip.
  const previewQ = useSchedulePreviewQuery();
  const missed = useMemo(
    () => missedByHabit(previewQ.data?.unscheduled, habitsQ.data),
    [previewQ.data, habitsQ.data],
  );

  const summary = habitSummary(habits);
  const loaded = !habitsQ.isLoading && !habitsQ.isError;

  return (
    <div className="px-4 pb-6 pt-4 md:px-1 md:pt-0">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4">
        {loaded && (
          <section data-testid="habit-summary" aria-label="Habit summary" className="glass flex animate-rise flex-wrap items-center gap-4 rounded-panel px-5 py-[22px] sm:gap-6 sm:px-6">
            <Stat value={String(summary.active)} label={summary.active === 1 ? 'active habit' : 'active habits'} />
            <span aria-hidden="true" className="h-12 w-px bg-fg/10" />
            <Stat value={summary.weeklyLabel} label="booked per week" />
            <span aria-hidden="true" className="h-12 w-px bg-fg/10" />
            <Stat value={String(summary.paused)} label="paused" />
          </section>
        )}
        <QuickAdd placeholder="Add a habit…" label="New habit name" onAdd={(title) => createM.mutate(defaultQuickAddInput(title))} />
        {habitsQ.isLoading && <div className="text-sm text-fg-2">Loading habits…</div>}
        {habitsQ.isError && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-danger">Couldn't load habits.</span>
            <button onClick={() => void habitsQ.refetch()} className="btn-glass rounded-pill px-3 py-1.5">Retry</button>
          </div>
        )}
        {loaded && habits.length === 0 && (
          <p className="text-sm text-fg-2">No habits yet — add one above.</p>
        )}
        <div className="flex flex-col gap-3">
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h} unscheduledCount={missed.get(h.id) ?? 0}
              onEdit={setEditing}
              onToggleStatus={(habit) => updateM.mutate({ id: habit.id, patch: { status: habit.status === 'active' ? 'paused' : 'active' } })}
              onDelete={(habit) => deleteM.mutate(habit.id)} />
          ))}
        </div>
      </div>
      {editing && (
        <DrawerHost
          compact={compact}
          label="Edit habit"
          onClose={() => setEditing(null)}
          desktopClass="fixed inset-0 z-50 flex animate-bd-in items-center justify-center bg-overlay p-4 backdrop-blur-[8px]"
        >
          {/* Keyed by id: the drawer seeds its form once at mount, and the overlay is no focus
              trap, so keyboard Edit on another row switches the habit under a mounted drawer. */}
          <HabitDrawer key={editing.id} habit={editing} compact={compact} saving={updateM.isPending}
            error={updateM.error instanceof ApiError ? { message: saveErrorText(updateM.error) } : null}
            onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
            onCancel={() => setEditing(null)} />
        </DrawerHost>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[34px] font-light leading-none tracking-[-0.03em] tabular-nums sm:text-[44px]">{value}</span>
      <span className="text-[13px] text-fg-2">{label}</span>
    </div>
  );
}
