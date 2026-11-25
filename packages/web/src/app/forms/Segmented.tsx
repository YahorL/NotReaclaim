import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<K extends string> { key: K; label: string }

/**
 * The glass pill switch from the prototypes (`.seg` / `.seg.on`). One component, two ARIA
 * patterns: `tablist` (Stats Chart | Table — pass `idBase` so each tab controls its panel) and
 * `radiogroup` (Settings Appearance). Both rove: ←/→/Home/End move the selection and focus, and
 * only the selected option is in the tab order.
 */
export function Segmented<K extends string>({ kind, label, options, value, onChange, idBase }: {
  kind: 'tablist' | 'radiogroup';
  label: string;
  options: SegmentedOption<K>[];
  value: K;
  onChange: (key: K) => void;
  /** tablist only: tab ids are `${idBase}-tab-${key}` and they control `${idBase}-panel-${key}`. */
  idBase?: string;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = options.findIndex((o) => o.key === value);
    let j: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = options.length - 1;
    if (j === null) return;
    e.preventDefault();
    const next = options[j]!.key;
    onChange(next);
    refs.current[next]?.focus();
  };
  const tabs = kind === 'tablist';
  return (
    <div role={kind} aria-label={label} className="glass-card inline-flex shrink-0 gap-0.5 rounded-pill p-[3px]">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            ref={(n) => { refs.current[o.key] = n; }}
            type="button"
            role={tabs ? 'tab' : 'radio'}
            id={tabs && idBase ? `${idBase}-tab-${o.key}` : undefined}
            aria-controls={tabs && idBase ? `${idBase}-panel-${o.key}` : undefined}
            aria-selected={tabs ? on : undefined}
            aria-checked={tabs ? undefined : on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.key)}
            onKeyDown={onKey}
            className={`h-[34px] rounded-pill px-3.5 text-[13px] transition-colors coarse:h-11 ${on ? 'bg-fg/[.14] text-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]' : 'text-fg-2 hover:text-fg'}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
