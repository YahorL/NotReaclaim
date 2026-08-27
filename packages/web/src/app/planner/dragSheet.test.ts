import { describe, it, expect } from 'vitest';
import { COLLAPSED_SHEET_STRIP_PX, shouldCollapseSheet } from './dragSheet';

describe('shouldCollapseSheet', () => {
  it('collapses when a task drag starts inside an open sheet on the compact layout', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: true, isTaskDrag: true })).toBe(true);
  });

  it('never collapses on the desktop layout — the panel is inline there', () => {
    expect(shouldCollapseSheet({ compact: false, sheetOpen: true, isTaskDrag: true })).toBe(false);
  });

  it('does nothing when the sheet is already closed', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: false, isTaskDrag: true })).toBe(false);
  });

  it('ignores drags that are not task cards', () => {
    expect(shouldCollapseSheet({ compact: true, sheetOpen: true, isTaskDrag: false })).toBe(false);
  });

  it('leaves a strip tall enough to grab the sheet back', () => {
    expect(COLLAPSED_SHEET_STRIP_PX).toBe(56);
  });
});
