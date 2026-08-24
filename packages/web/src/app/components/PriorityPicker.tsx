import { BUCKETS, BUCKET_META, bucketToPriority, priorityToBucket } from '../priorities/priorityBucket';

/**
 * Compact pill chips for the four priority buckets. Value/onChange speak numeric priorities.
 * Laid out 2×2: four chips in one line need ~230px, which the New Task modal's rows don't have.
 */
export function PriorityPicker({ value, onChange }: { value: number; onChange: (priority: number) => void }) {
  const selected = priorityToBucket(value);
  return (
    <div role="group" aria-label="Priority" className="grid grid-cols-2 gap-1">
      {BUCKETS.map((bucket) => {
        const active = bucket === selected;
        // BUCKET_META labels read "High priority"; the chips only have room for the first word.
        const label = BUCKET_META[bucket].label.split(' ')[0]!;
        return (
          <button
            key={bucket}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(bucketToPriority(bucket))}
            className={`flex items-center justify-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold transition-colors ${active ? 'bg-indigo text-white' : 'border border-line bg-bg text-inkSoft'}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${BUCKET_META[bucket].dot}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
