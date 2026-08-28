import { describe, it, expect } from 'vitest';
import { makeAnnouncements, POINTER_ONLY_DRAG_INSTRUCTIONS } from './announcements';

const titles: Record<string, string> = { t1: 'Write spec' };
const targets: Record<string, string> = { 'col:high': 'the High priority column' };
const a = makeAnnouncements((id) => titles[id] ?? null, (id) => targets[id] ?? null);

const active = { id: 't1' } as never;
const over = { id: 'col:high' } as never;

describe('drag announcements', () => {
  it('names the dragged item instead of reading out its id', () => {
    expect(a.onDragStart({ active })).toBe('Picked up Write spec.');
  });

  it('names the drop target, and says so when there is none', () => {
    expect(a.onDragOver({ active, over })).toBe('Write spec is over the High priority column.');
    expect(a.onDragOver({ active, over: null })).toBe('Write spec is not over a drop target.');
  });

  it('reports the end of the drag', () => {
    expect(a.onDragEnd({ active, over })).toBe('Write spec was dropped on the High priority column.');
    expect(a.onDragEnd({ active, over: null })).toBe('Write spec was dropped where it started.');
    expect(a.onDragCancel({ active, over: null })).toBe('Moving Write spec was cancelled.');
  });

  it('falls back to the raw id when a lookup misses, and never promises a keyboard lift', () => {
    expect(a.onDragStart({ active: { id: 'unknown-cuid' } as never })).toBe('Picked up unknown-cuid.');
    // The planner's drag surface runs Mouse+Touch sensors only — dnd-kit's stock instructions
    // tell a screen-reader user to press the space bar, which does nothing there.
    expect(POINTER_ONLY_DRAG_INSTRUCTIONS.draggable).not.toMatch(/space bar/i);
  });
});
