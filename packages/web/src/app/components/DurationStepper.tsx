import { msToHM } from '../lib/duration';
import { MS_PER_MIN, SLOT_MIN } from '../lib/time';
import { Icons } from '../shell/icons';

const STEP = SLOT_MIN * MS_PER_MIN;
const DEFAULT_SIZE = 26;

export function durationLabel(ms: number): string {
  const { hours, minutes } = msToHM(ms);
  if (hours && minutes) return `${hours} hr ${minutes} min`;
  if (hours) return `${hours} hr${hours > 1 ? 's' : ''}`;
  return `${minutes} mins`;
}

// Literal class strings per variant (Tailwind JIT). Default = the prototype's `.big` 22px value
// and 34px `.step` glass buttons (New task dialog, Settings). Compact = every caller passing a
// smaller `size` (TaskDrawer, HabitDrawer, CreatePopover): their half-width columns cannot hold
// "2 hr 15 min" at 22px beside two 34px buttons. Both grow to a 44px target on a coarse pointer.
// The value never shrinks below its text and the button pair wraps under it as a unit when a
// narrow column (TaskDrawer at tablet width with 44px touch buttons) cannot hold both.
const VALUE = 'flex-[1_0_auto] whitespace-nowrap font-medium tabular-nums text-fg';
const VALUE_DEFAULT = `${VALUE} text-[22px]`;
const VALUE_COMPACT = `${VALUE} text-[17px]`;
const BTN = 'btn-glass focus-ring grid shrink-0 place-items-center rounded-full text-fg coarse:h-11 coarse:w-11';
const BTN_DEFAULT = `${BTN} h-[34px] w-[34px]`;
const BTN_COMPACT = `${BTN} h-[30px] w-[30px]`;

/** Human duration + round glass −/+ buttons stepping ±15 min (floor 15 min). `size` scales the icons. */
export function DurationStepper({ valueMs, onChange, disabled = false, label, size = DEFAULT_SIZE }: {
  valueMs: number; onChange: (ms: number) => void; disabled?: boolean; label: string; size?: number;
}) {
  const compact = size < DEFAULT_SIZE;
  const btn = compact ? BTN_COMPACT : BTN_DEFAULT;
  const icon = Math.round(size * 0.55);
  return (
    <div data-testid="duration-stepper" data-compact={compact || undefined} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span data-testid="duration-value" className={compact ? VALUE_COMPACT : VALUE_DEFAULT}>{durationLabel(valueMs)}</span>
      <div className="ml-auto flex shrink-0 gap-2">
        <button type="button" aria-label={`decrease ${label}`} disabled={disabled} onClick={() => onChange(Math.max(STEP, valueMs - STEP))} className={btn}>
          <Icons.minus size={icon} className="[stroke-width:2.2]" />
        </button>
        <button type="button" aria-label={`increase ${label}`} disabled={disabled} onClick={() => onChange(valueMs + STEP)} className={btn}>
          <Icons.plus size={icon} className="[stroke-width:2.2]" />
        </button>
      </div>
    </div>
  );
}
