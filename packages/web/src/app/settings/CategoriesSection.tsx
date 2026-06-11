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
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {COLOR_PALETTE.map((hex) => (
        <button
          key={hex}
          data-testid={`cat-color-${categoryId}-${hex}`}
          onClick={() => onSelect(hex)}
          title={hex}
          style={{ backgroundColor: hex }}
          className={`h-5 w-5 rounded-full border-2 transition-transform hover:scale-110 ${current === hex ? 'border-ink ring-2 ring-indigo/40' : 'border-transparent'}`}
        />
      ))}
      {/* None swatch */}
      <button
        data-testid={`cat-color-${categoryId}-none`}
        onClick={() => onSelect(null)}
        title="No color"
        className={`h-5 w-5 rounded-full border-2 bg-line transition-transform hover:scale-110 ${current === null ? 'border-ink ring-2 ring-indigo/40' : 'border-transparent'}`}
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
    <div className="mb-2 rounded-[11px] border border-line bg-card p-3" data-testid={`cat-row-${category.id}`}>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <input
            ref={nameRef}
            data-testid={`cat-name-${category.id}`}
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={handleNameCommit}
            onKeyDown={handleNameKeyDown}
            className="rounded-[9px] border border-line px-2 py-0.5 text-sm font-semibold text-ink focus:border-indigo focus:outline-none"
          />
          {category.isDefault && <span className="ml-1 text-[11px] font-normal text-inkSoft">(default)</span>}
        </div>
        <button
          data-testid={`delete-${category.id}`}
          disabled={category.isDefault || deleteM.isPending}
          onClick={() => deleteM.mutate(category.id)}
          className="rounded-[9px] px-2 py-0.5 text-[12px] font-semibold text-red-500 hover:bg-red-50 disabled:opacity-40"
        >Delete</button>
      </div>

      {/* Color swatches for all categories */}
      <ColorSwatches categoryId={category.id} current={category.color} onSelect={handleColorSelect} />

      {category.isDefault ? (
        <div className="mt-2">
          <label className="flex items-center gap-2 text-[12px] font-semibold text-inkSoft">
            <input
              type="checkbox"
              data-testid="cat-default-custom"
              checked={useCustom}
              onChange={(e) => handleCustomToggle(e.target.checked)}
              className="accent-indigo h-4 w-4 rounded"
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
                className="mt-1 rounded-[9px] bg-indigo px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50"
              >Save hours</button>
            </>
          )}
          {!useCustom && (
            <p className="mt-1 text-[12px] text-inkSoft">Uses your working hours above.</p>
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
            className="mt-1 rounded-[9px] bg-indigo px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50"
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
    <section className="mb-4 max-w-md rounded-[14px] border border-line bg-card p-4" data-testid="categories-section">
      <h3 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-inkSoft">Categories</h3>
      {(categoriesQ.data ?? []).map((c) => <CategoryRow key={c.id} category={c} />)}

      {adding ? (
        <div className="rounded-[11px] border border-line p-3">
          <input
            data-testid="cat-name-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name…"
            className="mb-1.5 w-full rounded-[9px] border border-line px-2 py-1 text-sm font-semibold text-ink focus:border-indigo focus:outline-none"
          />
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix="newcat" />
          {!ok && <p className="mb-1 text-[11px] text-red-600">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              data-testid="save-new-category"
              disabled={!ok || createM.isPending}
              onClick={submit}
              className="rounded-[9px] bg-indigo px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50"
            >Create</button>
            <button
              onClick={() => { setAdding(false); setName(''); setDays(windowsToDays([])); }}
              className="rounded-[9px] border border-line px-3 py-1 text-[12px] font-semibold text-inkSoft hover:bg-indigoSoft"
            >Cancel</button>
          </div>
        </div>
      ) : (
        <button data-testid="add-category" onClick={() => setAdding(true)} className="mt-1 rounded-[9px] px-2 py-1 text-[13px] font-bold text-indigo hover:bg-indigoSoft">+ Add category</button>
      )}
    </section>
  );
}
