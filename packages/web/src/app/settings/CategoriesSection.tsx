import { useState, useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Category, UpdateCategoryInput } from '../../api/types';
import { saveErrorText } from '../lib/saveError';
import { FIELD_ERROR } from '../components/formStyles';
import { useCategoriesQuery, useCreateCategoryMutation, useUpdateCategoryMutation, useDeleteCategoryMutation } from '../../api/queries';
import { PrimaryButton, SecondaryButton } from '../components/Buttons';
import { CAPS_LABEL, CHECKBOX, DANGER_TEXT_BTN, INPUT } from '../forms/controls';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';
import { validateCategoryForm } from './categoryForm';
import { type DayState, windowsToDays, daysToWindows, patchDay, weeklyHoursTotal, weeklyHoursLabel } from './weeklyHours';
import { checkInkOn } from '../lib/contrast';

// Category colours are user data (stored hex), so they stay inline; the names are for screen readers.
const COLOR_PALETTE: { hex: string; name: string }[] = [
  { hex: '#5b62e3', name: 'Indigo' }, { hex: '#4285f4', name: 'Blue' }, { hex: '#0f9d58', name: 'Green' },
  { hex: '#f4b400', name: 'Amber' }, { hex: '#db4437', name: 'Red' }, { hex: '#9c27b0', name: 'Purple' },
  { hex: '#00acc1', name: 'Cyan' }, { hex: '#795548', name: 'Brown' },
];
const SWATCHES: { hex: string | null; name: string }[] = [...COLOR_PALETTE, { hex: null, name: 'No color' }];
/** The selection ring: a page-coloured gap, then the swatch colour (prototype `.sw` on). */
const ringFor = (hex: string) => `0 0 0 2px rgb(var(--c-page)), 0 0 0 4px ${hex}`;

/**
 * Colour picker as a radio group (spec §4.8). Each pick PATCHes the category, so the arrow keys
 * only MOVE focus (roving tabindex) and Space/Enter selects — the ARIA radio pattern's
 * select-on-arrow would fire a PATCH per key press.
 */
function ColorSwatches({ categoryId, categoryName, current, onSelect }: {
  categoryId: string;
  categoryName: string;
  current: string | null;
  onSelect: (color: string | null) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checkedIndex = Math.max(0, SWATCHES.findIndex((sw) => sw.hex === current));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let j: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % SWATCHES.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + SWATCHES.length) % SWATCHES.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = SWATCHES.length - 1;
    if (j === null) return;
    e.preventDefault();
    refs.current[j]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={`${categoryName} color`} className="flex flex-wrap gap-2">
      {SWATCHES.map((sw, i) => {
        const on = sw.hex === current;
        return (
          <button
            key={sw.name}
            ref={(n) => { refs.current[i] = n; }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={sw.name}
            tabIndex={i === checkedIndex ? 0 : -1}
            data-testid={`cat-color-${categoryId}-${sw.hex ?? 'none'}`}
            onClick={() => onSelect(sw.hex)}
            onKeyDown={(e) => onKey(e, i)}
            title={sw.name}
            style={sw.hex
              ? { backgroundColor: sw.hex, color: checkInkOn(sw.hex), boxShadow: on ? ringFor(sw.hex) : 'inset 0 1px 0 rgba(255,255,255,.3)' }
              : (on ? { boxShadow: ringFor('rgb(var(--c-text-1) / .6)') } : undefined)}
            className={`flex h-7 w-7 items-center justify-center rounded-pill transition-transform hover:scale-110 coarse:h-10 coarse:w-10 ${sw.hex ? '' : 'border-[1.5px] border-dashed border-fg/45 text-fg'}`}
          >
            {on && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
            )}
          </button>
        );
      })}
    </div>
  );
}

const NAME_INPUT = `${INPUT} h-11 min-w-0 rounded-[14px] px-3.5 text-[17px] font-medium`;

function CategoryRow({ category }: { category: Category }) {
  const updateM = useUpdateCategoryMutation();
  const deleteM = useDeleteCategoryMutation();
  // Update and delete share one error line; whichever was triggered last owns it.
  // Only a settled error is reset, so an in-flight request keeps its pending state and its result.
  const update = (patch: UpdateCategoryInput) => { if (deleteM.isError) deleteM.reset(); updateM.mutate({ id: category.id, patch }); };
  const remove = () => { if (updateM.isError) updateM.reset(); deleteM.mutate(category.id); };
  const rowError = updateM.isError ? updateM.error : deleteM.isError ? deleteM.error : null;
  // Seeded once from props; the row reflects in-place edits. key={id} is stable.
  const [days, setDays] = useState<DayState[]>(() => windowsToDays(category.windows));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => patchDay(ds, weekday, patch));

  // Default category: tracks whether custom windows are toggled on.
  const [useCustom, setUseCustom] = useState<boolean>(() => category.isDefault ? category.windows !== null : true);

  const [localName, setLocalName] = useState(category.name);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleNameCommit = () => {
    const trimmed = localName.trim();
    if (!trimmed || trimmed === category.name) return;
    update({ name: trimmed });
  };

  const handleNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      nameRef.current?.blur();
    } else if (e.key === 'Escape') {
      setLocalName(category.name);
      nameRef.current?.blur();
    }
  };

  const handleCustomToggle = (checked: boolean) => {
    setUseCustom(checked);
    if (!checked) {
      // Turning off: inherit global working hours
      update({ windows: null });
    }
  };

  const { ok, error } = validateCategoryForm(localName, days);

  const showsHours = !category.isDefault || useCustom;
  const weekly = showsHours ? weeklyHoursLabel(weeklyHoursTotal(daysToWindows(days))) : 'Follows Settings';

  const hoursEditor = (
    <>
      <WeeklyHoursEditor days={days} onChange={setDay} idPrefix={`cat-${category.id}`} showCoverage coverageColor={category.color} />
      {!ok && <p className={FIELD_ERROR}>{error}</p>}
      <div>
        <PrimaryButton
          data-testid={`save-${category.id}`}
          disabled={!ok || updateM.isPending}
          onClick={() => update({ windows: daysToWindows(days) })}
        >Save hours</PrimaryButton>
      </div>
    </>
  );

  return (
    <section aria-label={category.name} className="glass flex flex-col gap-4 rounded-panel px-[22px] py-5" data-testid={`cat-row-${category.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={nameRef}
          aria-label="Category name"
          data-testid={`cat-name-${category.id}`}
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameCommit}
          onKeyDown={handleNameKeyDown}
          className={`${NAME_INPUT} flex-[0_1_280px]`}
        />
        {category.isDefault && <span data-testid={`cat-default-chip-${category.id}`} className="chip">Default</span>}
        <span data-testid={`cat-weekly-${category.id}`} className="chip">{weekly}</span>
        <button
          type="button"
          data-testid={`delete-${category.id}`}
          disabled={category.isDefault || deleteM.isPending}
          onClick={remove}
          className={`ml-auto ${DANGER_TEXT_BTN}`}
        >Delete</button>
      </div>

      <ColorSwatches
        categoryId={category.id}
        categoryName={category.name}
        current={category.color}
        onSelect={(color) => update({ color })}
      />

      {category.isDefault && (
        <>
          <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
            <input
              type="checkbox"
              data-testid="cat-default-custom"
              checked={useCustom}
              onChange={(e) => handleCustomToggle(e.target.checked)}
              className={CHECKBOX}
            />
            Use custom working hours
          </label>
          {!useCustom && (
            <p className="text-[13px] text-fg-2">
              Uses your working hours from <Link to="/settings" className="text-accent-fg underline underline-offset-2">Settings</Link>.
            </p>
          )}
        </>
      )}
      {showsHours && hoursEditor}
      {rowError && <p data-testid={`cat-error-${category.id}`} className={FIELD_ERROR}>{saveErrorText(rowError)}</p>}
    </section>
  );
}

export function CategoriesSection() {
  const categoriesQ = useCategoriesQuery();
  const createM = useCreateCategoryMutation();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [days, setDays] = useState<DayState[]>(() => windowsToDays([]));
  const setDay = (weekday: number, patch: Partial<DayState>) =>
    setDays((ds) => patchDay(ds, weekday, patch));
  const { ok, error } = validateCategoryForm(name, days);

  const resetNew = () => { setAdding(false); setName(''); setDays(windowsToDays([])); if (createM.isError) createM.reset(); };
  // Opening starts clean: a create cancelled while in flight can fail AFTER the cancel's reset, and
  // its error must not greet the next form. Resetting also detaches that create's callbacks, so a
  // late success cannot close the new form either.
  const openNew = () => { createM.reset(); setAdding(true); };

  const submit = () => {
    const windows = daysToWindows(days);
    createM.mutate({ name: name.trim(), windows }, { onSuccess: resetNew });
  };

  return (
    <section aria-labelledby="categories-caption" className="flex flex-col gap-4" data-testid="categories-section">
      <h2 id="categories-caption" className={`px-1.5 ${CAPS_LABEL}`}>Categories</h2>
      {(categoriesQ.data ?? []).map((c) => <CategoryRow key={c.id} category={c} />)}

      {adding ? (
        <section aria-label="New category" className="glass flex flex-col gap-4 rounded-panel px-[22px] py-5">
          <input
            data-testid="cat-name-input"
            aria-label="Category name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Category name…"
            className={`${NAME_INPUT} w-full max-w-[280px]`}
          />
          <WeeklyHoursEditor days={days} onChange={setDay} idPrefix="newcat" showCoverage />
          {!ok && <p className={FIELD_ERROR}>{error}</p>}
          {createM.isError && <p data-testid="new-category-error" className={FIELD_ERROR}>{saveErrorText(createM.error)}</p>}
          <div className="flex gap-2">
            <PrimaryButton data-testid="save-new-category" disabled={!ok || createM.isPending} onClick={submit}>Create</PrimaryButton>
            <SecondaryButton onClick={resetNew}>Cancel</SecondaryButton>
          </div>
        </section>
      ) : (
        <button
          type="button"
          data-testid="add-category"
          onClick={openNew}
          className="btn-glass inline-flex h-[52px] items-center justify-center gap-2 rounded-pill border-dashed text-[15px]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add category
        </button>
      )}
    </section>
  );
}
