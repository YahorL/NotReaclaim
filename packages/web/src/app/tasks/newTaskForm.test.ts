import { describe, it, expect } from 'vitest';
import { defaultNewTaskForm, validateNewTaskForm, toCreateTaskInput, chunkSeed, reseedChunkFields } from './taskForm';

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

describe('newTaskForm', () => {
  it('defaults: 1h duration, split on, due in 7 days, settings chunk defaults', () => {
    const s = defaultNewTaskForm(NOW, 'UTC', { defaultMinChunkMs: 900_000, defaultMaxChunkMs: 5_400_000 });
    expect(s.durationMs).toBe(3_600_000);
    expect(s.split).toBe(true);
    expect(s.minChunkMs).toBe(900_000);
    expect(s.maxChunkMs).toBe(5_400_000);
    expect(toCreateTaskInput(s, 'UTC').dueBy).toBe('2026-01-12T23:59:00.000Z');
  });

  it('falls back to 30m/120m chunk when no settings', () => {
    const s = defaultNewTaskForm(NOW, 'UTC');
    expect(s.minChunkMs).toBe(1_800_000);
    expect(s.maxChunkMs).toBe(7_200_000);
  });

  it('validates title, positive duration, and min <= max', () => {
    const base = defaultNewTaskForm(NOW, 'UTC');
    expect(validateNewTaskForm({ ...base, title: '' }, 'UTC').ok).toBe(false);
    expect(validateNewTaskForm({ ...base, durationMs: 0 }, 'UTC').ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'x', minChunkMs: 9_000_000, maxChunkMs: 1_000_000 }, 'UTC').ok).toBe(false);
    expect(validateNewTaskForm({ ...base, title: 'Write spec' }, 'UTC').ok).toBe(true);
  });

  it('ignores min > max when split is off (chunks collapse to duration)', () => {
    const base = defaultNewTaskForm(Date.parse('2026-01-05T00:00:00.000Z'), 'UTC');
    expect(validateNewTaskForm({ ...base, title: 'x', split: false, minChunkMs: 9_000_000, maxChunkMs: 1_000_000 }, 'UTC').ok).toBe(true);
    // still invalid when split is on
    expect(validateNewTaskForm({ ...base, title: 'x', split: true, minChunkMs: 9_000_000, maxChunkMs: 1_000_000 }, 'UTC').ok).toBe(false);
  });

  it('defaults priority to 4 (Low)', () => {
    expect(defaultNewTaskForm(NOW, 'UTC').priority).toBe(4);
  });

  it('carries a chosen priority through to the create input', () => {
    const base = defaultNewTaskForm(NOW, 'UTC');
    expect(toCreateTaskInput({ ...base, title: 'X', priority: 2 }, 'UTC').priority).toBe(2);
  });

  it('toCreateTaskInput passes the form priority through and split-off collapses min=max=duration', () => {
    const s = { ...defaultNewTaskForm(NOW, 'UTC'), title: 'Write spec', durationMs: 3_600_000, split: false, minChunkMs: 1_800_000, maxChunkMs: 7_200_000 };
    const input = toCreateTaskInput(s, 'UTC');
    expect(input.priority).toBe(4);
    expect(input.minChunkMs).toBe(3_600_000);
    expect(input.maxChunkMs).toBe(3_600_000);
    expect(input.title).toBe('Write spec');
    expect(input.categoryId).toBeNull();
  });

  it('carries categoryId through to the create input', () => {
    const base = defaultNewTaskForm(Date.parse('2026-01-05T00:00:00.000Z'), 'UTC');
    const out = toCreateTaskInput({ ...base, title: 'X', categoryId: 'cat-9' }, 'UTC');
    expect(out.categoryId).toBe('cat-9');
  });

  it('accepts an empty due date', () => {
    const validState = { ...defaultNewTaskForm(NOW, 'UTC'), title: 'Write spec' };
    expect(validateNewTaskForm({ ...validState, dueByLocal: '' }, 'UTC').ok).toBe(true);
  });

  it('emits a null dueBy for an empty due date', () => {
    const validState = { ...defaultNewTaskForm(NOW, 'UTC'), title: 'Write spec' };
    expect(toCreateTaskInput({ ...validState, dueByLocal: '' }, 'UTC').dueBy).toBeNull();
  });

  it('still defaults a new task to seven days out', () => {
    const s = defaultNewTaskForm(Date.parse('2026-01-05T12:00:00.000Z'), 'UTC');
    expect(s.dueByLocal).not.toBe('');
  });

  it('round-trips notBeforeLocal to notBefore (set and empty→null)', () => {
    const base = defaultNewTaskForm(Date.parse('2026-01-05T00:00:00.000Z'), 'UTC');
    expect(toCreateTaskInput({ ...base, title: 'X', notBeforeLocal: '' }, 'UTC').notBefore).toBeNull();
    const out = toCreateTaskInput({ ...base, title: 'X', notBeforeLocal: '2026-01-06T13:00' }, 'UTC');
    expect(out.notBefore).toBe(new Date('2026-01-06T13:00').toISOString());
  });
});

describe('new-task date fields that do not convert in the zone', () => {
  const UNKNOWN_ZONE = 'Mars/Olympus_Mons';

  it('blocks the form and flags each unconvertible date field', () => {
    const s = { ...defaultNewTaskForm(NOW, 'UTC'), title: 'X' };
    const r = validateNewTaskForm(s, UNKNOWN_ZONE);
    expect(r.ok).toBe(false);
    expect(r.errors.dueByLocal).toBeTruthy();
    expect(r.errors.notBeforeLocal).toBeTruthy();
    expect(validateNewTaskForm({ ...s, dueByLocal: '', notBeforeLocal: '' }, UNKNOWN_ZONE).ok).toBe(true);
  });

  it('never maps a failed conversion to null in the create payload', () => {
    const s = { ...defaultNewTaskForm(NOW, 'UTC'), title: 'X' };
    expect(() => toCreateTaskInput(s, UNKNOWN_ZONE)).toThrow();
  });
});

describe('defaultNewTaskForm default times', () => {
  const NOW = Date.parse('2026-01-07T15:30:00.000Z'); // a Wednesday afternoon

  it('defaults Schedule after to today 08:00 local', () => {
    expect(defaultNewTaskForm(NOW, 'UTC').notBeforeLocal).toBe('2026-01-07T08:00');
  });

  it('defaults Due date to one week out at 23:59 local', () => {
    expect(defaultNewTaskForm(NOW, 'UTC').dueByLocal).toBe('2026-01-14T23:59');
  });
});

describe('defaultNewTaskForm / toCreateTaskInput in the settings zone', () => {
  it('New York: defaults are wall-clock in the settings zone, not the browser zone', () => {
    // 02:00Z on Jan 7 is still Jan 6 (21:00) in New York.
    const s = defaultNewTaskForm(Date.parse('2026-01-07T02:00:00.000Z'), 'America/New_York');
    expect(s.notBeforeLocal).toBe('2026-01-06T08:00');
    expect(s.dueByLocal).toBe('2026-01-13T23:59');
    const input = toCreateTaskInput({ ...s, title: 'X' }, 'America/New_York');
    expect(input.notBefore).toBe('2026-01-06T13:00:00.000Z');
    expect(input.dueBy).toBe('2026-01-14T04:59:00.000Z');
  });

  it('Tokyo: the settings-zone day is already the next calendar day', () => {
    // 20:00Z on Jan 6 is 05:00 on Jan 7 in Tokyo.
    const s = defaultNewTaskForm(Date.parse('2026-01-06T20:00:00.000Z'), 'Asia/Tokyo');
    expect(s.notBeforeLocal).toBe('2026-01-07T08:00');
    expect(s.dueByLocal).toBe('2026-01-14T23:59');
    expect(toCreateTaskInput({ ...s, title: 'X' }, 'Asia/Tokyo').dueBy).toBe('2026-01-14T14:59:00.000Z');
  });

  it('DST: +7 days is seven calendar days, not 7 × 24h (spring-forward week in New York)', () => {
    // Sat Mar 7 23:30 EST; clocks spring forward on Sun Mar 8.
    const s = defaultNewTaskForm(Date.parse('2026-03-08T04:30:00.000Z'), 'America/New_York');
    expect(s.dueByLocal).toBe('2026-03-14T23:59');
    expect(toCreateTaskInput({ ...s, title: 'X' }, 'America/New_York').dueBy).toBe('2026-03-15T03:59:00.000Z');
  });
});

describe('chunk defaults seeding', () => {
  const S = { defaultMinChunkMs: 45 * 60_000, defaultMaxChunkMs: 90 * 60_000 };

  it('chunkSeed: settings defaults, else the built-in 30 / 120 fallback', () => {
    expect(chunkSeed(S)).toEqual({ minChunkMs: 45 * 60_000, maxChunkMs: 90 * 60_000 });
    expect(chunkSeed(undefined)).toEqual({ minChunkMs: 30 * 60_000, maxChunkMs: 120 * 60_000 });
  });

  it('reseedChunkFields: untouched fields take the new seed, edited fields keep their value', () => {
    const form = { ...defaultNewTaskForm(0, 'UTC'), maxChunkMs: 135 * 60_000 };
    const next = reseedChunkFields(form, chunkSeed(undefined), chunkSeed(S));
    expect(next.minChunkMs).toBe(45 * 60_000);
    expect(next.maxChunkMs).toBe(135 * 60_000);
    // Everything else is carried through untouched.
    expect({ ...next, minChunkMs: form.minChunkMs }).toEqual(form);
  });
});
