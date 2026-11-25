import { describe, it, expect } from 'vitest';
import { sortByDue, splitShown, PANEL_GROUP_LIMIT } from './panelTasks';

const t = (id: string, dueBy: string | null, priority = 3, title = id) => ({ id, dueBy, priority, title });

describe('sortByDue (All tasks tab)', () => {
  it('orders by due date, earliest first', () => {
    const out = sortByDue([t('b', '2026-01-10T00:00:00Z'), t('a', '2026-01-08T00:00:00Z'), t('c', '2026-02-01T00:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('puts undated tasks last', () => {
    const out = sortByDue([t('none', null), t('dated', '2026-01-10T00:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['dated', 'none']);
  });

  it('breaks a due tie by priority (1 = critical first), then title', () => {
    const due = '2026-01-10T00:00:00Z';
    const out = sortByDue([t('x', due, 3, 'Zeta'), t('y', due, 1, 'Mid'), t('z', due, 3, 'Alpha'), t('n1', null, 4, 'B'), t('n2', null, 2, 'A')]);
    expect(out.map((x) => x.id)).toEqual(['y', 'z', 'x', 'n2', 'n1']);
  });

  it('does not mutate its input', () => {
    const input = [t('b', '2026-01-10T00:00:00Z'), t('a', '2026-01-08T00:00:00Z')];
    sortByDue(input);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('splitShown (Show N more)', () => {
  it('shows the first five and folds the rest', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(PANEL_GROUP_LIMIT).toBe(5);
    expect(splitShown(items, false)).toEqual({ shown: [1, 2, 3, 4, 5], hidden: 2 });
  });

  it('shows everything when expanded or short', () => {
    expect(splitShown([1, 2, 3, 4, 5, 6], true)).toEqual({ shown: [1, 2, 3, 4, 5, 6], hidden: 0 });
    expect(splitShown([1, 2], false)).toEqual({ shown: [1, 2], hidden: 0 });
  });
});
