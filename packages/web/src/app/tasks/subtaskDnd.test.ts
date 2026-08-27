import { describe, it, expect } from 'vitest';
import { subtaskDropSortOrder } from './subtaskDnd';

const two = [
  { id: 's1', sortOrder: 0 },
  { id: 's2', sortOrder: 1 },
];

describe('subtaskDropSortOrder', () => {
  it('dragging the last item onto the first lands above it', () => {
    // Ported verbatim from the deleted TaskDrawer HTML5 test: s2 above s1 => 0 - 1 = -1.
    expect(subtaskDropSortOrder(two, 's2', 's1')).toBe(-1);
  });

  it('dragging the first item onto the second lands BELOW it', () => {
    // Semantic change from the HTML5 path (which said 0): arrayMove puts the dragged item where
    // the live preview showed it, so a downward drag lands after the hovered row => 1 + 1 = 2.
    expect(subtaskDropSortOrder(two, 's1', 's2')).toBe(2);
  });

  it('landing between two items takes the midpoint', () => {
    const three = [
      { id: 'a', sortOrder: 10 },
      { id: 'b', sortOrder: 20 },
      { id: 'c', sortOrder: 30 },
    ];
    // c upward onto b => lands above b, between a(10) and b(20).
    expect(subtaskDropSortOrder(three, 'c', 'b')).toBe(15);
  });

  it('returns null when the item is dropped on itself', () => {
    expect(subtaskDropSortOrder(two, 's1', 's1')).toBeNull();
  });

  it('returns null for an unknown active or over id', () => {
    expect(subtaskDropSortOrder(two, 'nope', 's1')).toBeNull();
    expect(subtaskDropSortOrder(two, 's1', 'nope')).toBeNull();
  });

  it('returns null for a single-item list', () => {
    expect(subtaskDropSortOrder([{ id: 'only', sortOrder: 3 }], 'only', 'only')).toBeNull();
  });
});

describe('subtaskDropSortOrder — card checklist cases', () => {
  const three = [
    { id: 's1', sortOrder: 10 },
    { id: 's2', sortOrder: 20 },
    { id: 's3', sortOrder: 30 },
  ];

  it('dragging the last subtask onto the first lands above it', () => {
    // Ported verbatim from the deleted TaskRow HTML5 test: 10 - 1 = 9.
    expect(subtaskDropSortOrder(three, 's3', 's1')).toBe(9);
  });

  it('dragging the first subtask onto the last lands BELOW it', () => {
    // Semantic change from the HTML5 path (which said 25): a downward drag now lands after the
    // hovered row, so the value is past the tail => 30 + 1 = 31.
    expect(subtaskDropSortOrder(three, 's1', 's3')).toBe(31);
  });
});
