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

export function HabitRow({ habit, onEdit, onToggleStatus, onDelete }: HabitRowProps) {
  const [confirming, setConfirming] = useState(false);
  const paused = habit.status === 'paused';
  const days = [...habit.eligibleDays].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' ');
  return (
    <div data-testid="habit-row" className={`flex items-center gap-2 border-b border-gray-100 px-2 py-1.5 text-sm ${paused ? 'opacity-60' : ''}`}>
      <span className="flex-1 font-medium">{habit.title}</span>
      <span className="text-xs text-gray-500">{formatDurationShort(habit.chunkMs)} × {habit.perPeriod}/week · {days}</span>
      {confirming ? (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-gray-500">Delete?</span>
          <button onClick={() => { onDelete(habit); setConfirming(false); }} className="text-red-600">Yes</button>
          <button onClick={() => setConfirming(false)} className="text-gray-600">Cancel</button>
        </span>
      ) : (
        <span className="flex gap-1">
          <button onClick={() => onEdit(habit)} className="rounded border border-gray-200 px-1.5 text-xs">edit</button>
          <button onClick={() => onToggleStatus(habit)} className="rounded border border-gray-200 px-1.5 text-xs">{paused ? 'resume' : 'pause'}</button>
          <button aria-label="delete" onClick={() => setConfirming(true)} className="rounded border border-gray-200 px-1.5 text-xs text-red-600">×</button>
        </span>
      )}
    </div>
  );
}
