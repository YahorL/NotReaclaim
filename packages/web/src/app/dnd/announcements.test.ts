import { describe, it, expect } from 'vitest';
import { makeAnnouncements, makeSubtaskAnnouncements, POINTER_ONLY_DRAG_INSTRUCTIONS } from './announcements';

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

describe('subtask drag announcements', () => {
  const subtasks = [
    { id: 's1', title: 'Outline' },
    { id: 's2', title: 'Draft' },
    { id: 's3', title: 'Review' },
    { id: 's4', title: 'Send' },
  ];
  const s = makeSubtaskAnnouncements(subtasks, 'Write spec');
  const at = (id: string) => ({ id }) as never;

  it('names the subtask, its position and its task on pick-up', () => {
    expect(s.onDragStart({ active: at('s2') })).toBe('Picked up Draft, position 2 of 4 in Write spec.');
  });

  it('reads the position it would land in while moving — distinct per step, so each one is spoken', () => {
    expect(s.onDragOver({ active: at('s2'), over: at('s2') })).toBe('Draft is over position 2 of 4.');
    expect(s.onDragOver({ active: at('s2'), over: at('s3') })).toBe('Draft is over position 3 of 4.');
    expect(s.onDragOver({ active: at('s2'), over: at('s1') })).toBe('Draft is over position 1 of 4.');
    expect(s.onDragOver({ active: at('s2'), over: null })).toBe('Draft is not over a drop target.');
  });

  it('reports where it was dropped, or that it stayed put', () => {
    expect(s.onDragEnd({ active: at('s2'), over: at('s4') })).toBe('Draft was dropped at position 4 of 4 in Write spec.');
    expect(s.onDragEnd({ active: at('s2'), over: at('s2') })).toBe('Draft was dropped where it started.');
    expect(s.onDragEnd({ active: at('s2'), over: null })).toBe('Draft was dropped where it started.');
    expect(s.onDragCancel({ active: at('s2'), over: null })).toBe('Moving Draft was cancelled.');
  });

  it('never reads a raw id when it can help it, and falls back to it when it cannot', () => {
    for (const text of [
      s.onDragStart({ active: at('s3') }),
      s.onDragOver({ active: at('s3'), over: at('s1') }),
      s.onDragEnd({ active: at('s3'), over: at('s1') }),
    ]) expect(text).not.toMatch(/s\d/);
    expect(s.onDragStart({ active: at('ghost') })).toBe('Picked up ghost.');
    expect(s.onDragOver({ active: at('s1'), over: at('ghost') })).toBe('Outline is over ghost.');
  });
});
