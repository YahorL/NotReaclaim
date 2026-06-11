import { useState, useRef } from 'react';
import type { Category, WorkingHour } from '../../api/types';
import { useCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation } from '../../api/queries';
import type { DayState } from './settingsForm';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import { windowsToDays, daysToWindows, validateCategoryForm } from './categoryForm';

const COLOR_PALETTE = ['#5b62e3', '#4285f4', '#0f9d58', '#f4b400', '#db4437', '#9c27b0', '#00acc1', '#795548'];

function ColorSwatches({ categoryId, current, onSelect }: {
  categoryId: string;
  current: string | null;
  onSelect: (color: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      {COLOR_PALETTE.map((hex) => (
        <button
          key={hex}
          data-testid={`cat-color-${categoryId}-${hex}`}
          onClick={() => onSelect(hex)}
          title={hex}
          style={{ backgroundColor: hex }}
          className={`h-5 w-5 rounded-full border-2 ${current === hex ? 'border-gray-800 ring-2 ring-gray-400' : 'border-transparent'}`}
        />
      ))}
      {/* None swatch */}
      <button
        data-testid={`cat-color-${categoryId}-none`}
        onClick={() => onSelect(null)}
        title="No color"
        className={`h-5 w-5 rounded-full border-2 bg-gray-200 ${current === null ? 'border-gray-800 ring-2 ring-gray-400' : 'border-transparent'}`}
      />
    </div>
  );
}

function CategoryRow({ category }: { category: Category }) {
  const updateM = useUpdateCategoryMutation();
  const deleteM = useDeleteCategoryMutation();
  // Seeded once from props; the row reflects in-place edits. key={id} is stable.
  const [days, setDays] = useState<DayState[]>(() => windowsToDays(category.windows));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => ds.map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)));

  // Default category: tracks whether custom windows are toggled on.
  const [useCustom, setUseCustom] = useState<boolean>(() => category.isDefault ? category.windows !== null : true);

  // Inline name editing
  const [localName, setLocalName] = useState(category.name);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleNameCommit = () => {
    const trimmed = localName.trim();
    if (!trimmed || trimmed === category.name) return;
    updateM.mutate({ id: category.id, patch: { name: trimmed } });
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      nameRef.current?.blur();
    } else if (e.key === 'Escape') {
      setLocalName(category.name);
      nameRef.current?.blur();
    }
  };

  // Color selection
  const handleColorSelect = (color: string | null) => {
    updateM.mutate({ id: category.id, patch: { color } });
  };

  // Default-category custom hours toggle
  const handleCustomToggle = (checked: boolean) => {
    setUseCustom(checked);
    if (!checked) {
      // Turning off: inherit global working hours
      updateM.mutate({ id: category.id, patch: { windows: null } });
    }
  };

  const { ok, error } = validateCategoryForm(localName, days);

  return (
    <div className="mb-2 rounded-lg border border-gray-200 p-3" data-testid={`cat-row-${category.id}`}>
      <div className="mb-1 flex items-center justify-between">
        <input
          ref={nameRef}
          data-testid={`cat-name-${category.id}`}
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameCommit}
          onKeyDown={handleNameKeyDown}
          className="rounded border border-gray-200 px-1 text-sm font-semibold focus:border-blue-400 focus:outline-none"
        />
        {category.isDefault && <span className="ml-1 text-xs font-normal text-gray-400">(default)</span>}
        <button
          data-testid={`delete-${category.id}`}
          disabled={category.isDefault || deleteM.isPending}
          onClick={() => deleteM.mutate(category.id)}
          className="text-[12px] text-red-600 disabled:opacity-40"
        >Delete</button>
      </div>

      {/* Color swatches for all categories */}
      <ColorSwatches categoryId={category.id} current={category.color} onSelect={handleColorSelect} />

      {category.isDefault ? (
        <div className="mt-2">
          <label className="flex items-center gap-2 text-[12px] text-gray-600">
            <input
              type="checkbox"
              data-testid="cat-default-custom"
              checked={useCustom}
              onChange={(e) => handleCustomToggle(e.target.checked)}
            />
            Use custom working hours
          </label>
          {useCustom && (
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
          {!useCustom && (
            <p className="text-[12px] text-gray-400">Uses your working hours above.</p>
          )}
        </div>
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
