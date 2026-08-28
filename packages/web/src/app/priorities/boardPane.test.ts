import { describe, it, expect } from 'vitest';
import { boardPaneClass } from './boardPane';

describe('boardPaneClass', () => {
  it('snaps the pane to the columns while idle', () => {
    const cls = boardPaneClass(false);
    expect(cls).toContain('snap-x');
    expect(cls).toContain('snap-mandatory');
    expect(cls).toContain('md:snap-none'); // no snapping under a mouse
    expect(cls).not.toContain(' snap-none');
  });

  it('turns snapping off for the duration of a drag', () => {
    // Mandatory snapping re-snaps every dnd-kit edge-auto-scroll tick: measured 2 scroll events
    // in 4s with snap on vs ~80 with it off, i.e. the pane teleports a column at a time.
    const cls = boardPaneClass(true);
    expect(cls).toContain('snap-none');
    expect(cls).not.toContain('snap-mandatory');
    expect(cls).not.toContain('snap-x');
  });

  it('keeps the scroll gutter and the phone-only overscroll containment in both states', () => {
    for (const cls of [boardPaneClass(false), boardPaneClass(true)]) {
      expect(cls).toContain('scroll-pl-[30px]');
      expect(cls).toContain('overscroll-contain');
      expect(cls).toContain('md:overscroll-auto');
    }
  });
});
