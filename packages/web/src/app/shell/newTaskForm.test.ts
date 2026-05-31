import { describe, it, expect } from 'vitest';
import { defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput } from './newTaskForm';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

describe('newTaskForm', () => {
  it('defaults: 1h duration, split on, due in 7 days, settings chunk defaults', () => {
    const s = defaultNewTaskForm(NOW, { defaultMinChunkMs: 900_000, defaultMaxChunkMs: 5_400_000 });
    expect(s.durationMs).toBe(3_600_000);
    expect(s.split).toBe(true);
    expect(s.minChunkMs).toBe(900_000);
    expect(s.maxChunkMs).toBe(5_400_000);
    expect(toCreateTaskInput(s).dueBy).toBe('2026-01-12T00:00:00.000Z');
  });

  it('falls back to 30m/120m chunk when no settings', () => {
    const s = defaultNewTaskForm(NOW);
    expect(s.minChunkMs).toBe(1_800_000);
    expect(s.maxChunkMs).toBe(7_200_000);
  });

  it('validates title, positive duration, and min <= max', () => {
    const base = defaultNewTaskForm(NOW);
    expect(validateNewTaskForm({ ...base, title: '' }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, durationMs: 0 }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'x', minChunkMs: 9_000_000, maxChunkMs: 1_000_000 }).ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'Write spec' }).ok).toBe(true);
  });

  it('toCreateTaskInput uses priority 4 and split-off collapses min=max=duration', () => {
    const s = { ...defaultNewTaskForm(NOW), title: 'Write spec', durationMs: 3_600_000, split: false, minChunkMs: 1_800_000, maxChunkMs: 7_200_000 };
    const input = toCreateTaskInput(s);
    expect(input.priority).toBe(4);
    expect(input.minChunkMs).toBe(3_600_000);
    expect(input.maxChunkMs).toBe(3_600_000);
    expect(input.title).toBe('Write spec');
    expect(input.category).toBeNull();
  });
});
