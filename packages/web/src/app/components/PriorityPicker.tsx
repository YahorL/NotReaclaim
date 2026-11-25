import { useRef, type KeyboardEvent } from 'react';
import { BUCKETS, BUCKET_META, bucketToPriority, priorityToBucket, type BucketKey } from '../priorities/priorityBucket';

/** Dot colours on the priority tokens (BUCKET_META's dot classes are P6's to migrate). */
const DOT: Record<BucketKey, string> = {
  critical: 'bg-pri-crit',
  high: 'bg-pri-high',
  medium: 'bg-pri-med',
  low: 'bg-pri-low',
};

const NEXT_KEYS = new Set(['ArrowRight', 'ArrowDown']);
const PREV_KEYS = new Set(['ArrowLeft', 'ArrowUp']);

/**
 * The four priority buckets as a 2×2 radio group of pills (prototype `.pchip`): dot + first word,
 * the checked pill inverted. Value/onChange speak numeric priorities.
 *
 * WAI-ARIA radio pattern: one tab stop (the checked radio), arrows move AND select, wrapping;
 * Home/End jump to the ends. Picking a priority has no side effect beyond the form value, so
 * selection-follows-focus is safe here (unlike the Hours colour swatches, which PATCH).
 */
export function PriorityPicker({ value, onChange }: { value: number; onChange: (priority: number) => void }) {
  const selected = priorityToBucket(value);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const pick = (index: number) => {
    const n = BUCKETS.length;
    const i = ((index % n) + n) % n;
    onChange(bucketToPriority(BUCKETS[i]!));
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (NEXT_KEYS.has(e.key)) pick(index + 1);
    else if (PREV_KEYS.has(e.key)) pick(index - 1);
    else if (e.key === 'Home') pick(0);
    else if (e.key === 'End') pick(BUCKETS.length - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div role="radiogroup" aria-label="Priority" className="grid grid-cols-2 gap-1.5">
      {BUCKETS.map((bucket, index) => {
        const active = bucket === selected;
        // BUCKET_META labels read "High priority"; the pills only have room for the first word.
        const label = BUCKET_META[bucket].label.split(' ')[0]!;
        return (
          <button
            key={bucket}
            ref={(el) => { refs.current[index] = el; }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            data-bucket={bucket}
            onClick={() => onChange(bucketToPriority(bucket))}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={`focus-ring inline-flex h-9 min-w-0 items-center justify-center gap-[7px] whitespace-nowrap rounded-pill border px-3 text-[13px] font-medium transition-[background-color,color,transform] duration-200 active:scale-95 coarse:h-11 ${active ? 'border-fg bg-fg text-page' : 'border-fg/[.08] bg-fg/[.05] text-fg/[.82] hover:bg-fg/10'}`}
          >
            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[bucket]}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
