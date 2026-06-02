import { useState } from 'react';
import type { Category, WorkingHour } from '../../api/types';
import { useCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation } from '../../api/queries';
import type { DayState } from './settingsForm';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import { windowsToDays, daysToWindows, validateCategoryForm } from './categoryForm';

function CategoryRow({ category }: { category: Category }) {
  const updateM = useUpdateCategoryMutation();
  const deleteM = useDeleteCategoryMutation();
  // Seeded once from props; the row reflects in-place edits. key={id} is stable, so a post-save refetch (which returns the user's own just-saved windows) does not re-seed — acceptable.
  const [days, setDays] = useState<DayState[]>(() => windowsToDays(category.windows));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const { ok, error } = validateCategoryForm(category.name, days);

  return (
    <div className="mb-2 rounded-lg border border-gray-200 p-3" data-testid={`cat-row-${category.id}`}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{category.name}{category.isDefault && <span className="font-normal text-gray-400"> (default)</span>}</span>
        <button
          data-testid={`delete-${category.id}`}
          disabled={category.isDefault || deleteM.isPending}
          onClick={() => deleteM.mutate(category.id)}
          className="text-[12px] text-red-600 disabled:opacity-40"
        >Delete</button>
      </div>
      {category.isDefault ? (
        <p className="text-[12px] text-gray-400">Uses your working hours above.</p>
      ) : (
        <>
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix={`cat-${category.id}`} />
          {!ok && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
          <button
            data-testid={`save-${category.id}`}
            disabled={!ok || updateM.isPending}
            onClick={() => updateM.mutate({ id: category.id, patch: { windows: daysToWindows(days) } })}
            className="mt-1 rounded bg-blue-600 px-3 py-1 text-[12px] text-white disabled:opacity-50"
          >Save hours</button>
        </>
      )}
    </div>
  );
}

export function CategoriesSection() {
  const categoriesQ = useCategoriesQuery();
  const createM = useCreateCategoryMutation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState<DayState[]>(() => windowsToDays([]));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));
  const { ok, error } = validateCategoryForm(name, days);

  const submit = () => {
    const windows: WorkingHour[] = daysToWindows(days);
    createM.mutate({ name: name.trim(), windows }, {
      onSuccess: () => { setAdding(false); setName(''); setDays(windowsToDays([])); },
    });
  };

  return (
    <section className="mb-4 max-w-md rounded-lg border border-gray-200 p-3" data-testid="categories-section">
      <h3 className="mb-2 text-sm font-semibold">Categories</h3>
      {(categoriesQ.data ?? []).map((c) => <CategoryRow key={c.id} category={c} />)}

      {adding ? (
        <div className="rounded-lg border border-gray-200 p-3">
          <input data-testid="cat-name-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name…" className="mb-1 w-full rounded border border-gray-300 px-2 py-0.5 text-sm" />
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix="newcat" />
          {!ok && <p className="mb-1 text-[11px] text-red-600">{error}</p>}
          <div className="mt-1 flex gap-2">
            <button data-testid="save-new-category" disabled={!ok || createM.isPending} onClick={submit} className="rounded bg-blue-600 px-3 py-1 text-[12px] text-white disabled:opacity-50">Create</button>
            <button onClick={() => { setAdding(false); setName(''); setDays(windowsToDays([])); }} className="rounded border border-gray-300 px-3 py-1 text-[12px]">Cancel</button>
          </div>
        </div>
      ) : (
        <button data-testid="add-category" onClick={() => setAdding(true)} className="text-[13px] font-bold text-blue-600">+ Add category</button>
      )}
    </section>
  );
}
