import { describe, it, expect } from 'vitest';
import type { Task } from '../../api/types';
import { toFormState, validateTaskForm, toUpdateInput, isUnsplit, withDuration, dateFieldToIso, toDateSeed, type TaskFormState } from './taskForm';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1', userId: 'u1', title: 'Write spec', priority: 2, sortOrder: 0, durationMs: 5_400_000,
  dueBy: '2026-06-01T17:00:00.000Z', minChunkMs: 1_800_000, maxChunkMs: 7_200_000,
  categoryId: 'cat-work', status: 'pending', completedAt: null, timeLoggedMs: 0,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

const validState = (over: Partial<TaskFormState> = {}): TaskFormState => ({
  title: 'X', durationMs: 3_600_000, dueByLocal: '2026-06-01T17:00',
  notBeforeLocal: '',
  minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null, ...over,
});

describe('taskForm', () => {
  it('toFormState maps a Task (ISO due → local; categoryId passthrough)', () => {
    expect(toFormState(task(), 'UTC')).toEqual({
      title: 'Write spec', durationMs: 5_400_000, dueByLocal: '2026-06-01T17:00',
      notBeforeLocal: '',
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: 'cat-work',
    });
    expect(toFormState(task({ categoryId: null }), 'UTC').categoryId).toBeNull();
  });

  it('validateTaskForm flags empty title, non-positive durations, min>max, bad due', () => {
    expect(validateTaskForm(validState(), 'UTC').ok).toBe(true);
    expect(validateTaskForm(validState({ title: '   ' }), 'UTC').errors.title).toBeTruthy();
    expect(validateTaskForm(validState({ durationMs: 0 }), 'UTC').errors.durationMs).toBeTruthy();
    expect(validateTaskForm(validState({ minChunkMs: 8_000_000 }), 'UTC').errors.maxChunkMs).toBeTruthy();
    expect(validateTaskForm(validState({ dueByLocal: 'not-a-date' }), 'UTC').errors.dueByLocal).toBeTruthy();
  });

  it('accepts an empty due date', () => {
    const s = validState({ dueByLocal: '' });
    expect(validateTaskForm(s, 'UTC').ok).toBe(true);
    expect(validateTaskForm(s, 'UTC').errors.dueByLocal).toBeUndefined();
  });

  it('emits a null dueBy for an empty due date', () => {
    expect(toUpdateInput(validState({ dueByLocal: '' }), 'UTC').dueBy).toBeNull();
  });

  it('still rejects an unparseable due date', () => {
    expect(validateTaskForm(validState({ dueByLocal: 'not-a-date' }), 'UTC').ok).toBe(false);
  });

  it('maps a null dueBy back to an empty field', () => {
    expect(toFormState(task({ dueBy: null }), 'UTC').dueByLocal).toBe('');
  });

  it('toUpdateInput converts local due → ISO and passes categoryId (no status)', () => {
    expect(toUpdateInput(validState({ categoryId: null }), 'UTC')).toEqual({
      title: 'X', durationMs: 3_600_000, dueBy: '2026-06-01T17:00:00.000Z',
      notBefore: null,
      minChunkMs: 1_800_000, maxChunkMs: 7_200_000, categoryId: null,
    });
  });

  it('round-trips categoryId through the edit form', () => {
    const state = toFormState(task({ categoryId: 'cat-7' }), 'UTC');
    expect(state.categoryId).toBe('cat-7');
    expect(toUpdateInput(state, 'UTC').categoryId).toBe('cat-7');
  });

  it('round-trips notBefore through the edit form', () => {
    const task = { id: 't', userId: 'u', title: 'A', priority: 3, durationMs: 3600000, dueBy: '2026-01-09T17:00:00.000Z', minChunkMs: 1800000, maxChunkMs: 3600000, categoryId: null, notBefore: '2026-01-06T13:00:00.000Z', status: 'pending', timeLoggedMs: 0, createdAt: '', updatedAt: '' };
    const state = toFormState(task as never, 'UTC');
    expect(state.notBeforeLocal).not.toBe('');
    expect(toUpdateInput(state, 'UTC').notBefore).toBe(new Date(state.notBeforeLocal).toISOString());
    expect(toUpdateInput({ ...state, notBeforeLocal: '' }, 'UTC').notBefore).toBeNull();
  });
});

describe('taskForm in the settings zone', () => {
  it('toFormState reads ISO dates as wall-clock in the settings zone (New York, EDT)', () => {
    const s = toFormState(task({ notBefore: '2026-06-01T02:30:00.000Z' } as Partial<Task>), 'America/New_York');
    expect(s.dueByLocal).toBe('2026-06-01T13:00');
    expect(s.notBeforeLocal).toBe('2026-05-31T22:30');
  });

  it('toFormState crosses the date line east of UTC (Auckland)', () => {
    expect(toFormState(task(), 'Pacific/Auckland').dueByLocal).toBe('2026-06-02T05:00');
  });

  it('toUpdateInput interprets wall-clock fields in the settings zone', () => {
    const out = toUpdateInput(validState({ notBeforeLocal: '2026-06-01T08:00' }), 'America/New_York');
    expect(out.dueBy).toBe('2026-06-01T21:00:00.000Z');
    expect(out.notBefore).toBe('2026-06-01T12:00:00.000Z');
    expect(toUpdateInput(validState(), 'Asia/Tokyo').dueBy).toBe('2026-06-01T08:00:00.000Z');
  });

  it('round-trips an instant unchanged through the edit form in a non-UTC zone', () => {
    const state = toFormState(task(), 'Pacific/Auckland');
    expect(toUpdateInput(state, 'Pacific/Auckland').dueBy).toBe('2026-06-01T17:00:00.000Z');
  });
});

describe('date fields that do not convert in the zone', () => {
  // A zone this runtime's Intl does not know: luxon cannot convert any wall-clock in it.
  const UNKNOWN_ZONE = 'Mars/Olympus_Mons';

  it('dateFieldToIso: empty → null (no value), convertible → ISO, unconvertible → undefined', () => {
    expect(dateFieldToIso('', 'UTC')).toBeNull();
    expect(dateFieldToIso('', UNKNOWN_ZONE)).toBeNull();
    expect(dateFieldToIso('2026-06-01T08:00', 'America/New_York')).toBe('2026-06-01T12:00:00.000Z');
    expect(dateFieldToIso('2026-06-01T08:00', UNKNOWN_ZONE)).toBeUndefined();
    expect(dateFieldToIso('not-a-date', 'UTC')).toBeUndefined();
  });

  it('flags BOTH date fields when they do not convert in the zone', () => {
    const r = validateTaskForm(validState({ notBeforeLocal: '2026-06-01T08:00' }), UNKNOWN_ZONE);
    expect(r.ok).toBe(false);
    expect(r.errors.dueByLocal).toBeTruthy();
    expect(r.errors.notBeforeLocal).toBeTruthy();
  });

  it('flags an unparseable Schedule after (it used to be saved as "no value")', () => {
    const r = validateTaskForm(validState({ notBeforeLocal: 'not-a-date' }), 'UTC');
    expect(r.ok).toBe(false);
    expect(r.errors.notBeforeLocal).toBeTruthy();
  });

  it('empty date fields stay valid in any zone (no deadline / no schedule-after)', () => {
    expect(validateTaskForm(validState({ dueByLocal: '', notBeforeLocal: '' }), UNKNOWN_ZONE).ok).toBe(true);
  });

  it('never maps a failed conversion to null in the payload', () => {
    expect(() => toUpdateInput(validState({ notBeforeLocal: 'not-a-date' }), 'UTC')).toThrow();
    expect(() => toUpdateInput(validState(), UNKNOWN_ZONE)).toThrow();
  });
});

describe('toUpdateInput with the seed: untouched dates keep their stored instant', () => {
  const NY = 'America/New_York';
  // Both instants show as "2026-11-01T01:30" in New York; re-reading that string picks 06:30Z.
  const EDT_0130 = '2026-11-01T05:30:00.000Z';
  const EST_0130 = '2026-11-01T06:30:00.000Z';
  const ambiguous = task({ dueBy: EDT_0130, notBefore: EST_0130 } as Partial<Task>);

  it('a title-only edit sends both ambiguous-hour instants back exactly', () => {
    const seed = toDateSeed(ambiguous, NY);
    const form = { ...toFormState(ambiguous, NY), title: 'Renamed' };
    expect(form.dueByLocal).toBe('2026-11-01T01:30');
    const out = toUpdateInput(form, NY, seed);
    expect(out.dueBy).toBe(EDT_0130);
    expect(out.notBefore).toBe(EST_0130);
  });

  it('a field the user changed is converted in the zone', () => {
    const seed = toDateSeed(ambiguous, NY);
    const out = toUpdateInput({ ...toFormState(ambiguous, NY), dueByLocal: '2026-11-02T09:00' }, NY, seed);
    expect(out.dueBy).toBe('2026-11-02T14:00:00.000Z');
    expect(out.notBefore).toBe(EST_0130);
  });

  it('clearing a field still sends null (clear), not the stored instant', () => {
    const seed = toDateSeed(ambiguous, NY);
    const out = toUpdateInput({ ...toFormState(ambiguous, NY), dueByLocal: '', notBeforeLocal: '' }, NY, seed);
    expect(out.dueBy).toBeNull();
    expect(out.notBefore).toBeNull();
  });

  it('toDateSeed pairs each shown wall-clock with the instant it came from', () => {
    expect(toDateSeed(ambiguous, NY)).toEqual({
      dueByLocal: '2026-11-01T01:30', notBeforeLocal: '2026-11-01T01:30', dueBy: EDT_0130, notBefore: EST_0130,
    });
    expect(toDateSeed(task({ dueBy: null }), 'UTC')).toEqual({ dueByLocal: '', notBeforeLocal: '', dueBy: null, notBefore: null });
  });
});

describe('unsplit tasks: chunk sizes follow the duration', () => {
  const H = 3_600_000;
  const M = 60_000;
  const unsplit = task({ durationMs: H, minChunkMs: H, maxChunkMs: H });

  it('isUnsplit is true only when min = max = duration', () => {
    expect(isUnsplit(unsplit)).toBe(true);
    expect(isUnsplit(task({ durationMs: H, minChunkMs: 30 * M, maxChunkMs: H }))).toBe(false);
    expect(isUnsplit(task({ durationMs: H, minChunkMs: H, maxChunkMs: 2 * H }))).toBe(false);
    expect(isUnsplit(task({ durationMs: 90 * M, minChunkMs: H, maxChunkMs: H }))).toBe(false);
  });

  it('60 → 90 on an unsplit task saves 90 / 90 / 90', () => {
    const form = withDuration(toFormState(unsplit, 'UTC'), 90 * M, true);
    expect(validateTaskForm(form, 'UTC').ok).toBe(true);
    expect(toUpdateInput(form, 'UTC')).toEqual(expect.objectContaining({ durationMs: 90 * M, minChunkMs: 90 * M, maxChunkMs: 90 * M }));
  });

  it('60 → 30 on an unsplit task saves 30 / 30 / 30', () => {
    const form = withDuration(toFormState(unsplit, 'UTC'), 30 * M, true);
    expect(validateTaskForm(form, 'UTC').ok).toBe(true);
    expect(toUpdateInput(form, 'UTC')).toEqual(expect.objectContaining({ durationMs: 30 * M, minChunkMs: 30 * M, maxChunkMs: 30 * M }));
  });

  it('without follow (split task, or chunks edited by hand) only the duration changes', () => {
    const form = withDuration(validState({ durationMs: H, minChunkMs: 45 * M, maxChunkMs: 75 * M }), 90 * M, false);
    expect(form).toEqual(validState({ durationMs: 90 * M, minChunkMs: 45 * M, maxChunkMs: 75 * M }));
  });
});
