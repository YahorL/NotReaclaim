import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import type { Task, SchedulePreview } from '../../api/types';
import { useEffect } from 'react';
import { PlannerTaskPanel } from './PlannerTaskPanel';
import { RecentlyCreatedProvider, useRecentlyCreated } from '../shell/RecentlyCreated';

const NOW = Date.parse('2026-01-07T12:00:00.000Z');

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0,
    durationMs: 3_600_000, dueBy: '2026-01-10T17:00:00.000Z', minChunkMs: 1, maxChunkMs: 1,
    categoryId: null, notBefore: null, status: 'pending', completedAt: null,
    createdAt: '', updatedAt: '', subtasks: [], ...over,
  } as Task;
}

function renderPanel(tasks: Task[], preview?: SchedulePreview, handlers: Partial<{
  onComplete: (t: Task) => void; onEdit: (t: Task) => void; onDelete: (t: Task) => void;
}> = {}) {
  return render(
    <PlannerTaskPanel
      tasks={tasks}
      preview={preview}
      nowMs={NOW} zone="UTC"
      onComplete={handlers.onComplete ?? vi.fn()}
      onEdit={handlers.onEdit ?? vi.fn()}
      onDelete={handlers.onDelete ?? vi.fn()}
    />,
  );
}

describe('PlannerTaskPanel', () => {
  it('groups active tasks under their priority bucket and shows a duration chip', () => {
    renderPanel([
      task({ id: 'a', title: 'Critical thing', priority: 1, durationMs: 7_200_000 }),
      task({ id: 'b', title: 'Low thing', priority: 4 }),
    ]);
    expect(screen.getByRole('heading', { name: /critical/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /low priority/i })).toBeInTheDocument();
    expect(screen.getByText('Critical thing')).toBeInTheDocument();
    expect(screen.getByText('2h')).toBeInTheDocument(); // 7.2M ms → 2h chip
  });

  it('omits backlog and completed tasks', () => {
    renderPanel([
      task({ id: 'a', title: 'Active', status: 'pending' }),
      task({ id: 'b', title: 'In backlog', status: 'backlog' }),
      task({ id: 'c', title: 'Done', status: 'completed' }),
    ]);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.queryByText('In backlog')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('fires complete / edit / delete handlers', () => {
    const onComplete = vi.fn(); const onEdit = vi.fn(); const onDelete = vi.fn();
    renderPanel([task({ id: 'a', title: 'Do it' })], undefined, { onComplete, onEdit, onDelete });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Do it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Do it' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Do it' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('flags an at-risk (unscheduled) task', () => {
    const preview: SchedulePreview = {
      blocks: [],
      unscheduled: [{ sourceType: 'task', sourceId: 'a', title: 'Risky', reason: 'no time', remainingMs: 3_600_000 }],
    };
    renderPanel([task({ id: 'a', title: 'Risky' })], preview);
    expect(screen.getByTestId('panel-at-risk')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Not scheduled' })).toBeInTheDocument();
  });

  it('switches to a flat All tasks tab', () => {
    renderPanel([
      task({ id: 'a', title: 'Critical thing', priority: 1 }),
      task({ id: 'b', title: 'Low thing', priority: 4 }),
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'All tasks' }));
    expect(screen.getByRole('tab', { name: 'All tasks' })).toHaveAttribute('aria-selected', 'true');
    // Bucket headers gone in the flat view; both tasks still listed
    expect(screen.queryByRole('heading', { name: /critical/i })).toBeNull();
    expect(screen.getByText('Critical thing')).toBeInTheDocument();
    expect(screen.getByText('Low thing')).toBeInTheDocument();
  });

  it('exposes the two views as tabs and moves between them with the arrow keys', () => {
    renderPanel([task()]);
    const pri = screen.getByRole('tab', { name: 'Priorities' });
    const all = screen.getByRole('tab', { name: 'All tasks' });
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(pri).toHaveAttribute('aria-selected', 'true');
    expect(pri).toHaveAttribute('tabindex', '0');
    expect(all).toHaveAttribute('tabindex', '-1');
    pri.focus();
    fireEvent.keyDown(pri, { key: 'ArrowRight' });
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expect(pri).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Priorities');
  });

  it('All tasks sorts by due date (undated last), and labels each row with its priority', () => {
    renderPanel([
      task({ id: 'u', title: 'Undated', dueBy: null, priority: 1 }),
      task({ id: 'l', title: 'Later', dueBy: '2026-01-20T00:00:00.000Z', priority: 1 }),
      task({ id: 's', title: 'Sooner', dueBy: '2026-01-09T00:00:00.000Z', priority: 4 }),
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'All tasks' }));
    const cards = screen.getAllByTestId('panel-task');
    expect(cards.map((c) => c.getAttribute('data-task-id'))).toEqual(['s', 'l', 'u']);
    expect(within(cards[0]!).getByTestId('panel-priority')).toHaveTextContent('Low');
    expect(within(cards[2]!).getByTestId('panel-priority')).toHaveTextContent('Critical');
    expect(cards[2]).toHaveTextContent('No deadline');
  });

  it('Priorities groups show five tiles and a "Show N more" toggle', () => {
    renderPanel(Array.from({ length: 7 }, (_, i) => task({ id: `h${i}`, title: `High ${i}`, priority: 2, sortOrder: i })));
    expect(screen.getAllByTestId('panel-task')).toHaveLength(5);
    const more = screen.getByTestId('panel-show-more-high');
    expect(more).toHaveTextContent('Show 2 more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(screen.getAllByTestId('panel-task')).toHaveLength(7);
    expect(more).toHaveTextContent('Show less');
    fireEvent.click(more);
    expect(screen.getAllByTestId('panel-task')).toHaveLength(5);
  });

  it('no Show more for a group of five or fewer', () => {
    renderPanel(Array.from({ length: 5 }, (_, i) => task({ id: `h${i}`, priority: 2 })));
    expect(screen.queryByTestId('panel-show-more-high')).toBeNull();
  });

  it('the tab can be controlled from outside (summary card "+N more")', () => {
    const onTabChange = vi.fn();
    const { rerender } = render(
      <PlannerTaskPanel tasks={[task()]} preview={undefined} nowMs={NOW} zone="UTC" tab="priorities" onTabChange={onTabChange}
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'All tasks' }));
    expect(onTabChange).toHaveBeenCalledWith('tasks');
    rerender(
      <PlannerTaskPanel tasks={[task()]} preview={undefined} nowMs={NOW} zone="UTC" tab="tasks" onTabChange={onTabChange}
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('tab', { name: 'All tasks' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows an empty state when there are no active tasks', () => {
    renderPanel([]);
    expect(screen.getByText(/no active tasks/i)).toBeInTheDocument();
  });

  it('shows spent / total on a card', () => {
    renderPanel([task({ id: 'a', title: 'Has progress', durationMs: 7_200_000, spentMs: 3_600_000 })]);
    expect(screen.getByTestId('panel-progress')).toHaveTextContent('1h / 2h');
  });

  it('task cards are dnd-kit draggables keyed by the task id', () => {
    renderPanel([task({ id: 'drag-me', title: 'Grab me' })]);
    const card = screen.getByTestId('panel-task');
    expect(card).toHaveAttribute('aria-roledescription', 'draggable');
    expect(card).toHaveAttribute('data-task-id', 'drag-me');
    expect(card).not.toHaveAttribute('draggable');
    // The card holds complete/edit/delete buttons, so dnd-kit's default role='button' would
    // nest interactive content — it is a group that happens to be draggable.
    expect(card).toHaveAttribute('role', 'group');
    // No KeyboardSensor on this surface: dnd-kit's default tabIndex=0 would make every card a
    // tab stop announcing a space-bar lift that does nothing.
    expect(card).toHaveAttribute('tabindex', '-1');
  });

  it('fills its container in the compact (bottom-sheet) layout', () => {
    const { unmount } = render(
      <PlannerTaskPanel tasks={[task()]} preview={undefined} nowMs={NOW} zone="UTC" compact
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const aside = screen.getByTestId('planner-task-panel');
    expect(aside.className).toContain('w-full');
    expect(aside.className).not.toContain('w-[330px]');
    unmount();
    renderPanel([task()]);
    expect(screen.getByTestId('planner-task-panel').className).toContain('w-[330px]');
  });

  it('keeps the card actions visible on a coarse pointer', () => {
    render(
      <PlannerTaskPanel tasks={[task({ id: 'a', title: 'Do it' })]} preview={undefined} nowMs={NOW} zone="UTC" coarse
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    const actions = screen.getByRole('button', { name: 'Edit Do it' }).parentElement!;
    expect(actions.className).toContain('opacity-100');
    expect(actions.className).not.toContain('opacity-0');
  });

  it('gives the card controls touch-sized hit areas on a coarse pointer', () => {
    render(
      <PlannerTaskPanel tasks={[task({ id: 'a', title: 'Do it' })]} preview={undefined} nowMs={NOW} zone="UTC" coarse
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    // The 20px ✓ keeps its size and grows an invisible pseudo box instead.
    const complete = screen.getByRole('button', { name: 'Complete Do it' });
    expect(complete.className).toContain('coarse:before:-inset-3');
    expect(complete.className).toContain('relative');
    // ✎ and × are adjacent: padding + a wider gap, never overlapping pseudo boxes.
    expect(screen.getByRole('button', { name: 'Edit Do it' }).className).toContain('coarse:p-3');
    expect(screen.getByRole('button', { name: 'Edit Do it' }).parentElement!.className).toContain('coarse:gap-2');
  });

});

describe('PlannerTaskPanel labels in the settings zone', () => {
  it('reads the due day and the next-block time in the settings zone (Auckland)', () => {
    // NOW (12:00Z Jan 7) is 01:00 on Jan 8 in Auckland. 11:30Z Jan 10 is 00:30 on Jan 11 there;
    // 13:00Z Jan 8 is 02:00 on Jan 9 there ("Tomorrow", where the browser zone says 1:00 PM).
    const preview = {
      blocks: [{ sourceType: 'task', sourceId: 't1', start: Date.parse('2026-01-08T13:00:00.000Z'), end: Date.parse('2026-01-08T14:00:00.000Z') }],
      unscheduled: [],
    } as unknown as SchedulePreview;
    render(
      <PlannerTaskPanel
        tasks={[task({ dueBy: '2026-01-10T11:30:00.000Z' })]} preview={preview} nowMs={NOW} zone="Pacific/Auckland"
        onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Due Jan 11')).toBeInTheDocument();
    expect(screen.getByTestId('panel-next')).toHaveTextContent('Next: Tomorrow 2:00 AM');
  });
});

describe('PlannerTaskPanel tick-off motion', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ticking pops the check and draws the strike while the completion saves', () => {
    const onComplete = vi.fn();
    renderPanel([task({ id: 'a', title: 'Do it' })], undefined, { onComplete });
    const check = screen.getByRole('button', { name: 'Complete Do it' });
    expect(check).not.toHaveAttribute('data-ticked');
    expect(screen.getByTestId('panel-task-title').className).toContain('bg-[length:0_1.5px]');
    fireEvent.click(check);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(check).toHaveAttribute('data-ticked', 'true');
    expect(check.className).toContain('animate-pop-check');
    expect(screen.getByTestId('panel-task-title').className).toContain('bg-[length:100%_1.5px]');
  });

  it('un-ticks if the task is still listed a while later (the save failed)', () => {
    vi.useFakeTimers();
    renderPanel([task({ id: 'a', title: 'Do it' })]);
    const check = screen.getByRole('button', { name: 'Complete Do it' });
    fireEvent.click(check);
    act(() => { vi.advanceTimersByTime(4100); });
    expect(check).not.toHaveAttribute('data-ticked');
  });
});

describe('PlannerTaskPanel fresh glow', () => {
  function MarkOnMount({ id }: { id: string }) {
    const { markCreated } = useRecentlyCreated();
    useEffect(() => { markCreated(id); }, [id, markCreated]);
    return null;
  }

  it('marks only the just-created task card data-fresh (lime glow)', () => {
    render(
      <RecentlyCreatedProvider>
        <MarkOnMount id="b" />
        <PlannerTaskPanel
          tasks={[task({ id: 'a', title: 'Older' }), task({ id: 'b', title: 'Brand new' })]}
          preview={undefined} nowMs={NOW} zone="UTC"
          onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
        />
      </RecentlyCreatedProvider>,
    );
    const cards = screen.getAllByTestId('panel-task');
    const fresh = cards.find((c) => c.dataset.taskId === 'b')!;
    const older = cards.find((c) => c.dataset.taskId === 'a')!;
    expect(fresh).toHaveAttribute('data-fresh', 'true');
    expect(older).not.toHaveAttribute('data-fresh');
  });

  it('unfolds the group when the fresh task sorts behind "Show N more"', () => {
    const many = Array.from({ length: 7 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}`, priority: 2, sortOrder: i }));
    const { rerender } = render(
      <RecentlyCreatedProvider>
        <PlannerTaskPanel tasks={many.slice(0, 6)} preview={undefined} nowMs={NOW} zone="UTC"
          onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </RecentlyCreatedProvider>,
    );
    expect(screen.getByTestId('panel-show-more-high')).toHaveAttribute('aria-expanded', 'false');
    // The dialog marks it fresh before the tasks refetch lists it.
    rerender(
      <RecentlyCreatedProvider>
        <MarkOnMount id="t6" />
        <PlannerTaskPanel tasks={many.slice(0, 6)} preview={undefined} nowMs={NOW} zone="UTC"
          onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </RecentlyCreatedProvider>,
    );
    rerender(
      <RecentlyCreatedProvider>
        <MarkOnMount id="t6" />
        <PlannerTaskPanel tasks={many} preview={undefined} nowMs={NOW} zone="UTC"
          onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </RecentlyCreatedProvider>,
    );
    expect(screen.getByTestId('panel-show-more-high')).toHaveAttribute('aria-expanded', 'true');
    const fresh = screen.getAllByTestId('panel-task').find((c) => c.dataset.taskId === 't6');
    expect(fresh).toHaveAttribute('data-fresh', 'true');
  });

  it('leaves the group folded when the fresh task is above the fold', () => {
    const many = Array.from({ length: 7 }, (_, i) => task({ id: `t${i}`, title: `Task ${i}`, priority: 2, sortOrder: i }));
    render(
      <RecentlyCreatedProvider>
        <MarkOnMount id="t0" />
        <PlannerTaskPanel tasks={many} preview={undefined} nowMs={NOW} zone="UTC"
          onComplete={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />
      </RecentlyCreatedProvider>,
    );
    expect(screen.getByTestId('panel-show-more-high')).toHaveAttribute('aria-expanded', 'false');
  });

  it('nothing is fresh without the shell provider', () => {
    renderPanel([task({ id: 'a' })]);
    expect(screen.getByTestId('panel-task')).not.toHaveAttribute('data-fresh');
  });
});
