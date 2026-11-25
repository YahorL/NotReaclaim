import { useState } from 'react';

/** Glass pill input + lime Add (prototype Habits `.inp` + `.lime`). `label` names the input for
 *  screen readers (the placeholder is not a label); it defaults to the placeholder. */
export function QuickAdd({ placeholder, label, onAdd }: { placeholder: string; label?: string; onAdd: (title: string) => void }) {
  const [value, setValue] = useState('');
  const submit = () => {
    const title = value.trim();
    if (!title) return;
    onAdd(title);
    setValue('');
  };
  return (
    <div className="flex gap-2.5">
      <input
        aria-label={label ?? placeholder}
        className="h-12 min-w-0 flex-1 rounded-pill border border-fg/10 bg-fg/[.05] px-5 text-[15px] text-fg shadow-[inset_0_1px_2px_rgb(0_0_0/0.3)] outline-none transition-colors placeholder:text-fg-2 focus:border-focus"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      />
      <button type="button" onClick={submit} className="btn-accent inline-flex h-12 shrink-0 items-center gap-2 rounded-pill pl-[18px] pr-[22px] text-[15px] font-medium">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add
      </button>
    </div>
  );
}
