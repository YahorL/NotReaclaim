import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
import { TaskRow } from './TaskRow';
import type { Task } from '../../api/types';

const base = { id: 't', userId: 'u', title: 'T', priority: 1, sortOrder: 0, durationMs: 1, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1, categoryId: null, status: 'pending', completedAt: null, timeLoggedMs: 0, createdAt: '', updatedAt: '' };
const noop = () => {};
function renderRow(task: Task, over: { onEdit?: (t: Task) => void; onToggleSubtask?: (id: string, done: boolean) => void; onReorderSubtask?: (subtaskId: string, sortOrder: number) => void; draggable?: boolean } = {}) {
  return render(
    <TaskRow
      task={task} columnKey="critical" nextMs={null} now={Date.parse('2026-01-05T00:00:00.000Z')}
      draggable={over.draggable ?? true}
      onComplete={noop} onEdit={over.onEdit ?? noop} onDelete={noop}
      onToggleSubtask={over.onToggleSubtask ?? noop}
      onReorderSubtask={over.onReorderSubtask ?? noop}
    />,
  );
}

const twoSubtasks = [
  { id: 's1', taskId: 't', title: 'first step', done: true, sortOrder: 0 },
  { id: 's2', taskId: 't', title: 'second step', done: false, sortOrder: 1 },
];

describe('TaskRow subtask badge', () => {
  it('shows done/total when the task has subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByTestId('subtask-count')).toHaveTextContent('1/2');
  });
  it('shows no badge when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('subtask-count')).not.toBeInTheDocument();
  });
});

describe('TaskRow due label', () => {
  it('renders "Due <m/d>" for a task with a due date', () => {
    renderRow(base as Task);
    // Exact text: a doubled or dropped "Due " prefix must fail here.
    expect(screen.getByText('Due 1/9')).toBeInTheDocument();
  });

  it('renders "No deadline" for a task without a due date', () => {
    renderRow({ ...base, dueBy: null } as Task);
    expect(screen.getByText(/No deadline/)).toBeInTheDocument();
  });
});

describe('TaskRow subtask checklist', () => {
  it('renders one checkbox row per subtask, checked when done', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step')).toBeInTheDocument();
    expect(screen.getByText('second step')).toBeInTheDocument();
    expect(screen.getByTestId('card-subtask-s1')).toBeChecked();
    expect(screen.getByTestId('card-subtask-s2')).not.toBeChecked();
  });

  it('strikes through done subtasks', () => {
    renderRow({ ...base, subtasks: twoSubtasks } as Task);
    expect(screen.getByText('first step').className).toContain('line-through');
    expect(screen.getByText('second step').className).not.toContain('line-through');
  });

  it('toggling a checkbox reports the flipped value and does not open the editor', () => {
    const onToggleSubtask = vi.fn();
    const onEdit = vi.fn();
    renderRow({ ...base, subtasks: twoSubtasks } as Task, { onEdit, onToggleSubtask });
    fireEvent.click(screen.getByTestId('card-subtask-s2'));
    expect(onToggleSubtask).toHaveBeenCalledWith('s2', true);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('renders no checklist when there are no subtasks', () => {
    renderRow(base as Task);
    expect(screen.queryByTestId('card-subtasks')).not.toBeInTheDocument();
  });
});

describe('TaskRow menu outside-dismiss', () => {
  it('the row menu closes on an outside pointerdown', () => {
    renderRow(base as Task);
    fireEvent.click(screen.getByRole('button', { name: 'task menu' }));
    expect(screen.getByText('Delete')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Delete')).toBeNull();
  });
});

const threeSubtasks = [
  { id: 's1', taskId: 't', title: 'first', done: false, sortOrder: 10 },
  { id: 's2', taskId: 't', title: 'second', done: false, sortOrder: 20 },
  { id: 's3', taskId: 't', title: 'third', done: false, sortOrder: 30 },
];

describe('TaskRow card subtask drag handles', () => {
  it('each checklist row is a dnd-kit sortable with a stable testid', () => {
    renderRow({ ...base, subtasks: threeSubtasks } as Task);
    const first = screen.getByTestId('card-subtask-li-s1');
    expect(first).toHaveAttribute('aria-roledescription', 'sortable');
    // dnd-kit defaults a draggable to role="button"; on an <li> inside the card that destroys the
    // list semantics and nests the checkbox inside a button role, so the row keeps role=listitem.
    expect(first).toHaveAttribute('role', 'listitem');
    expect(first).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('card-subtask-li-s3')).toBeInTheDocument();
  });

  it('drops the native HTML5 drag attributes from the checklist', () => {
    renderRow({ ...base, subtasks: threeSubtasks } as Task);
    for (const id of ['s1', 's2', 's3']) {
      expect(screen.getByTestId(`card-subtask-li-${id}`)).not.toHaveAttribute('draggable');
    }
  });

  it('Space on a checklist checkbox is not swallowed by the keyboard drag sensor', () => {
    renderRow({ ...base, subtasks: threeSubtasks } as Task);
    // The row carries the KeyboardSensor's onKeyDown, so a Space keydown from the checkbox bubbles
    // into it. dnd-kit only ignores descendants when the row registered itself via
    // setActivatorNodeRef; without that it preventDefaults the key and the checkbox goes dead.
    const box = screen.getByTestId('card-subtask-s1');
    const ev = createEvent.keyDown(box, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    fireEvent(box, ev);
    expect(ev.defaultPrevented).toBe(false);
    // ...while the same key on the row itself is claimed by the sensor, i.e. the row is still the
    // activator and keyboard reordering works.
    const row = screen.getByTestId('card-subtask-li-s1');
    const rowEv = createEvent.keyDown(row, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    fireEvent(row, rowEv);
    expect(rowEv.defaultPrevented).toBe(true);
  });
});

describe('TaskRow sortable wiring', () => {
  it('carries the sortable attributes when draggable and none when not', () => {
    const { unmount } = renderRow(base as Task);
    expect(screen.getByTestId('task-row')).toHaveAttribute('aria-roledescription', 'sortable');
    // dnd-kit defaults a draggable to role="button"; on the card that nests the ✓ button, the
    // kebab menu and the subtask checkboxes inside a button role, so the card keeps role=group.
    expect(screen.getByTestId('task-row')).toHaveAttribute('role', 'group');
    unmount();
    renderRow(base as Task, { draggable: false });
    expect(screen.getByTestId('task-row')).not.toHaveAttribute('aria-roledescription');
  });
});
