import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Task } from '../../api/types';
import { useFocusTrap } from '../components/Sheet';
import { BUCKET_META, dueLabel, priorityToBucket } from '../priorities/priorityBucket';
import { Icons } from './icons';
import { searchTasks } from './taskSearch';
import { isOverlayOpen } from '../lib/overlay';

export interface TaskSearchPaletteProps {
  tasks: readonly Task[];
  /** settings.timezone, for the due labels. */
  zone: string;
  onSelect: (taskId: string) => void;
  onClose: () => void;
}

const LISTBOX_ID = 'task-search-listbox';
const optionId = (taskId: string) => `task-search-opt-${taskId}`;

function statusNote(task: Task, zone: string): string | null {
  if (task.status === 'completed') return 'Done';
  if (task.status === 'backlog') return 'Backlog';
  return dueLabel(task.dueBy, zone);
}

/**
 * Client-side task finder (spec §4.1 Search): a modal glass dialog with a combobox over the
 * task list. ↑/↓ move, Enter opens the task, Escape closes; focus returns to whatever opened it
 * (the header Search button, or wherever `/` / Ctrl+K was pressed). Mounted only while open.
 */
export function TaskSearchPalette({ tasks, zone, onSelect, onClose }: TaskSearchPaletteProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Explicit initial focus on the combobox. `autoFocus` alone is not enough under StrictMode (dev):
  // the double-run effect's first cleanup refocuses the opener, and the re-run then sees focus
  // outside the dialog and focuses the container. Pinned by the StrictMode test.
  const onKeyDown = useFocusTrap(dialogRef, { onEscape: onClose, initialFocus: () => inputRef.current });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchTasks(tasks, query), [tasks, query]);

  const current = results[Math.min(active, results.length - 1)];

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (Math.min(i, results.length - 1) + step + results.length) % results.length);
    } else if (e.key === 'Enter') {
      // Enter that commits an IME composition (Japanese, Chinese, …) is not "open this task".
      // keyCode 229: Safari reports the composing keydown that way, with isComposing false.
      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      if (current) onSelect(current.task.id);
    }
  };

  return (
    <div
      data-testid="task-search-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex animate-bd-in items-start justify-center bg-overlay backdrop-blur-[8px] md:px-4 md:pt-[12vh]"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search tasks"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="glass-dialog flex max-h-[80dvh] w-full animate-modal-in flex-col overflow-hidden rounded-b-panel pt-[env(safe-area-inset-top)] outline-none md:max-w-[560px] md:rounded-panel md:pt-0"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
          <Icons.search size={20} className="shrink-0 text-fg-2" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search tasks"
            aria-expanded={results.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current.task.id) : undefined}
            value={query}
            // A new query re-targets the first result.
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onInputKeyDown}
            placeholder="Search tasks…"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-fg outline-none placeholder:text-fg-3"
          />
          <kbd className="hidden shrink-0 rounded-input border border-line px-2 py-0.5 text-[11px] text-fg-2 md:inline">Esc</kbd>
        </div>

        <ul id={LISTBOX_ID} role="listbox" aria-label="Tasks" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 empty:hidden">
          {results.map(({ task, subtask }, i) => {
            const selected = current?.task.id === task.id;
            const note = statusNote(task, zone);
            return (
              <li
                key={task.id}
                id={optionId(task.id)}
                role="option"
                aria-selected={selected}
                data-status={task.status}
                // Keep focus (and the caret) in the input.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setActive(i)}
                onClick={() => onSelect(task.id)}
                className={`flex cursor-pointer items-center gap-3 rounded-input px-3 py-2.5 ${selected ? 'bg-fg/[.08]' : ''} ${task.status === 'completed' ? 'opacity-60' : ''}`}
              >
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_META[priorityToBucket(task.priority)].dot}`} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[15px] text-fg ${task.status === 'completed' ? 'line-through' : ''}`}>{task.title}</span>
                  {subtask && <span className="truncate text-[12px] text-fg-2">Subtask: {subtask}</span>}
                </span>
                {note && <span className="shrink-0 text-[12px] text-fg-2">{note}</span>}
              </li>
            );
          })}
        </ul>

        {results.length === 0 && (
          <p role="status" className="px-5 py-6 text-center text-[14px] text-fg-2">
            {query.trim() ? 'No tasks match' : 'Type to search your tasks'}
          </p>
        )}
      </div>
    </div>
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Global `/` and Ctrl/Cmd+K → open the palette. Ignored while typing in a field (the event target
 * or the focused element), while any dialog, sheet, menu or the create popover is open (the
 * palette itself included), and for keys something else already handled.
 */
export function useTaskSearchShortcut(onOpen: () => void): void {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey) return;
      const slash = e.key === '/' && !e.ctrlKey && !e.metaKey;
      // `key` can be missing on synthetic keydowns (e.g. Chrome autofill).
      const modK = e.key?.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey;
      if (!slash && !modK) return;
      if (isEditable(e.target) || isEditable(document.activeElement)) return;
      if (isOverlayOpen()) return;
      e.preventDefault();
      openRef.current();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
