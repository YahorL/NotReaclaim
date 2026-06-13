import { useState } from 'react';
import type { Habit } from '../../api/types';
import { formatDurationShort } from '../lib/duration';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface HabitRowProps {
  habit: Habit;
  onEdit: (habit: Habit) => void;
  onToggleStatus: (habit: Habit) => void;
  onDelete: (habit: Habit) => void;
}

// Pill button matching the app's design system (drawers/popovers).
const pill = 'rounded-full border border-line px-3 py-1 text-[13px] font-semibold text-inkSoft transition-colors hover:bg-bg hover:text-ink';

export function HabitRow({ habit, onEdit, onToggleStatus, onDelete }: HabitRowProps) {
  const [confirming, setConfirming] = useState(false);
  const paused = habit.status === 'paused';
  const days = [...habit.eligibleDays].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' ');
  return (
    <div
      data-testid="habit-row"
      className={`mb-1.5 flex items-center gap-3 rounded-[12px] border border-line bg-card px-3.5 py-2.5 shadow-card ${paused ? 'opacity-60' : ''}`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-bold text-ink">{habit.title}</div>
        <div className="mt-0.5 text-[12.5px] text-inkSoft">{formatDurationShort(habit.chunkMs)} × {habit.perPeriod}/week · {days}</div>
      </div>
      {confirming ? (
        <span className="flex items-center gap-2 text-[13px]">
          <span className="text-inkSoft">Delete?</span>
          <button type="button" onClick={() => { onDelete(habit); setConfirming(false); }} className="rounded-full bg-crit px-3 py-1 text-[13px] font-semibold text-white hover:opacity-90">Yes</button>
          <button type="button" onClick={() => setConfirming(false)} className={pill}>Cancel</button>
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => onEdit(habit)} className={pill}>Edit</button>
          <button type="button" onClick={() => onToggleStatus(habit)} className={pill}>{paused ? 'Resume' : 'Pause'}</button>
          <button type="button" aria-label="delete" onClick={() => setConfirming(true)} className="rounded-full border border-line px-2.5 py-1 text-[14px] font-bold text-crit transition-colors hover:bg-crit/10">×</button>
        </span>
      )}
    </div>
  );
}
