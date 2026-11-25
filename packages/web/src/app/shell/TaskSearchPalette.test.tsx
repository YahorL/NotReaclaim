import { StrictMode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Task } from '../../api/types';
import { TaskSearchPalette } from './TaskSearchPalette';

let n = 0;
function task(title: string, over: Partial<Task> = {}): Task {
  n += 1;
  return {
    id: `t${n}`, userId: 'u', title, priority: 2, sortOrder: n, durationMs: 3_600_000, dueBy: null,
    minChunkMs: 1_800_000, maxChunkMs: 3_600_000, categoryId: null, status: 'pending',
    completedAt: null, subtasks: [], createdAt: '', updatedAt: '', ...over,
  };
}

const TASKS = [
  task('Write docs', { dueBy: '2026-09-10T12:00:00Z' }),
  task('Review docs PR'),
  task('Old docs', { status: 'completed' }),
  task('Email Bob'),
];

function renderPalette(over: Partial<Parameters<typeof TaskSearchPalette>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<TaskSearchPalette tasks={TASKS} zone="UTC" onSelect={onSelect} onClose={onClose} {...over} />);
  return { onSelect, onClose, input: screen.getByRole('combobox', { name: 'Search tasks' }) };
}

const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

describe('TaskSearchPalette', () => {
  it('is a modal dialog whose combobox takes focus', () => {
    const { input } = renderPalette();
    expect(screen.getByRole('dialog', { name: 'Search tasks' })).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(input);
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox', { hidden: true }).id);
    expect(screen.getByRole('status')).toHaveTextContent('Type to search your tasks');
  });

  it('filters tasks as you type, active before completed', () => {
    const { input } = renderPalette();
    type(input, 'docs');
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Review docs PR'),
      expect.stringContaining('Write docs'),
      expect.stringContaining('Old docs'),
    ]);
    expect(options[1]).toHaveTextContent('Due Sep 10');
    expect(options[2]).toHaveTextContent('Done');
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows an empty state when nothing matches', () => {
    const { input } = renderPalette();
    type(input, 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('No tasks match');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('moves the active option with ↑/↓ (wrapping) and opens it with Enter', () => {
    const { input, onSelect } = renderPalette();
    type(input, 'docs');
    const [first, second, third] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first!.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(second).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', second!.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(third).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(TASKS[2]!.id);
  });

  it('opens a clicked result', () => {
    const { input, onSelect } = renderPalette();
    type(input, 'email');
    fireEvent.click(screen.getByRole('option', { name: /Email Bob/ }));
    expect(onSelect).toHaveBeenCalledWith(TASKS[3]!.id);
  });

  it('closes on Escape and on a backdrop click', () => {
    const { input, onClose } = renderPalette();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('task-search-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // StrictMode (main.tsx) runs effects twice in dev: the first cleanup refocuses the opener, so
  // `autoFocus` alone ends with the trap focusing the dialog container instead of the combobox.
  it('focuses the combobox under StrictMode when opened from a focused button', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    render(<StrictMode><TaskSearchPalette tasks={TASKS} zone="UTC" onSelect={vi.fn()} onClose={vi.fn()} /></StrictMode>);
    expect(document.activeElement).toBe(screen.getByRole('combobox'));
    opener.remove();
  });

  it('returns focus to the opener when it unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<TaskSearchPalette tasks={TASKS} zone="UTC" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
