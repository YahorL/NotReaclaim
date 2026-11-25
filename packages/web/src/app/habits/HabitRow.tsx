import { useState } from 'react';
import type { Habit } from '../../api/types';
import { formatDurationShort } from '../lib/duration';
import { WEEKDAY_SHORT } from '../lib/weekdays';
import { Icons } from '../shell/icons';
import { daysText } from './habitSummary';

export interface HabitRowProps {
  habit: Habit;
  /** Occurrences the engine could not place across the planning horizon (0 = everything fits). */
  unscheduledCount?: number;
  onEdit: (habit: Habit) => void;
  onToggleStatus: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}

/** Sun-first, like the habit drawer's day toggles. */
const PILL_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Prototype `.pbtn` (36px glass pill); coarse pointers get the 44px target.
const pill = 'btn-glass h-9 rounded-pill px-3.5 text-[13px] coarse:h-11';
const roundDanger = 'btn-glass flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-danger coarse:h-11 coarse:w-11';

export function HabitRow({ habit, unscheduledCount = 0, onEdit, onToggleStatus, onDelete }: HabitRowProps) {
  const [confirming, setConfirming] = useState(false);
  const paused = habit.status === 'paused';
  const eligible = new Set(habit.eligibleDays);
  const days = daysText(habit.eligibleDays);
  const daysForSr = days === 'any day' || days === 'no days'
    ? days
    : [...habit.eligibleDays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(', ');
  return (
    <div
      data-testid="habit-row"
      data-paused={paused}
      className={`glass flex flex-wrap items-center gap-x-[18px] gap-y-3.5 rounded-panel py-4 pl-5 pr-4 transition-[opacity,transform] duration-300 ${paused ? 'scale-[.99] opacity-[.55]' : ''}`}
    >
      <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="truncate text-[17px] font-medium">{habit.title}</span>
          {paused && <span data-testid="habit-paused" className="chip">Paused</span>}
          {unscheduledCount > 0 && (
            <span
              data-testid="habit-at-risk"
              // The preview spans the whole horizon (settings.horizonDays), which is several
              // partial weeks — so the copy names the horizon rather than a day count.
              title={`${unscheduledCount} ${unscheduledCount === 1 ? 'occurrence' : 'occurrences'} couldn't be scheduled in the planning horizon`}
              // No warning-surface token exists (spec §2.1); the danger text token carries it.
              className="chip text-danger"
            >
              <Icons.warning size={13} />
              {unscheduledCount} missed
            </span>
          )}
        </div>
        <span className="text-[13px] text-fg-2">{formatDurationShort(habit.chunkMs)} × {habit.perPeriod}/week · {days}</span>
      </div>

      {/* Read-only display of the eligible days (spec D16); the meta line above and the sr-only
          sentence carry the same information as text. */}
      <div data-testid="habit-days" className="flex gap-1">
        <span className="sr-only">Days: {daysForSr}</span>
        {PILL_LETTERS.map((letter, d) => {
          const on = eligible.has(d);
          return (
            <span
              key={d}
              aria-hidden="true"
              data-testid="habit-day"
              data-on={on}
              className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-pill border text-[11px] font-medium ${on ? 'border-accent/30 bg-accent/[.14] text-accent-fg' : 'border-fg/10 text-fg-2'}`}
            >
              {letter}
            </span>
          );
        })}
      </div>

      {confirming ? (
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="px-1 text-fg-2">Delete?</span>
          <button type="button" onClick={() => { onDelete(habit); setConfirming(false); }} className={`${pill} text-danger`}>Yes</button>
          <button type="button" onClick={() => setConfirming(false)} className={pill}>Cancel</button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => onEdit(habit)} className={pill}>Edit</button>
          <button type="button" onClick={() => onToggleStatus(habit)} className={pill}>{paused ? 'Resume' : 'Pause'}</button>
          <button type="button" aria-label={`Delete ${habit.title}`} onClick={() => setConfirming(true)} className={roundDanger}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
      )}
    </div>
  );
}
