import { useState } from 'react';
import type { Habit } from '../../api/types';
import { ApiError } from '../../api/client';
import { useHabitsQuery, useCreateHabitMutation, useUpdateHabitMutation, useDeleteHabitMutation } from '../../api/queries';
import { QuickAdd } from '../components/QuickAdd';
import { HabitRow } from '../habits/HabitRow';
import { HabitDrawer } from '../habits/HabitDrawer';
import { defaultQuickAddInput } from '../habits/habitForm';

export function Habits() {
  const habitsQ = useHabitsQuery();
  const createM = useCreateHabitMutation();
  const updateM = useUpdateHabitMutation();
  const deleteM = useDeleteHabitMutation();
  const [editing, setEditing] = useState<Habit | null>(null);

  const habits = habitsQ.data ?? [];

  return (
    <div className="flex gap-3 p-4">
      <div className="flex-1">
        <h2 className="mb-3 text-lg font-semibold">Habits</h2>
        <QuickAdd placeholder="+ Add a habit…" onAdd={(title) => createM.mutate(defaultQuickAddInput(title))} />
        {habitsQ.isLoading && <div className="text-sm text-gray-500">Loading habits…</div>}
        {habitsQ.isError && (
          <div className="text-sm">
            <span className="text-red-600">Couldn't load habits.</span>{' '}
            <button onClick={() => void habitsQ.refetch()} className="rounded border border-gray-300 px-2">Retry</button>
          </div>
        )}
        {!habitsQ.isLoading && !habitsQ.isError && habits.length === 0 && (
          <p className="text-sm text-gray-500">No habits yet — add one above.</p>
        )}
        <div>
          {habits.map((h) => (
            <HabitRow key={h.id} habit={h}
              onEdit={setEditing}
              onToggleStatus={(habit) => updateM.mutate({ id: habit.id, patch: { status: habit.status === 'active' ? 'paused' : 'active' } })}
              onDelete={(habit) => deleteM.mutate(habit.id)} />
          ))}
        </div>
      </div>
      {editing && (
        <HabitDrawer habit={editing} saving={updateM.isPending}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(patch) => updateM.mutate({ id: editing.id, patch }, { onSuccess: () => setEditing(null) })}
          onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
