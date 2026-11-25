import { describe, it, expect } from 'vitest';
import { blockVariant } from './blockStyle';

const ACCENT = '#5b62e3';

describe('blockVariant (spec §3 matrix)', () => {
  it('a Google meeting is solid violet, locked, with a lock icon', () => {
    const v = blockVariant({ kind: 'meeting', source: 'google' });
    expect(v.className).toContain('block-meeting');
    expect(v.locked).toBe(true);
    expect(v.icon).toBe('lock');
    expect(v.chip).toBe('Meeting · Locked');
  });

  it('an app-created event is solid violet but movable: no lock', () => {
    const v = blockVariant({ kind: 'meeting', source: 'app' });
    expect(v.className).toContain('block-meeting');
    expect(v.locked).toBe(false);
    expect(v.icon).toBeNull();
    expect(v.chip).toBe('Event · Movable');
  });

  it('blocked time is hatched and movable', () => {
    const v = blockVariant({ kind: 'blocked', source: 'app' });
    expect(v.className).toContain('block-blocked');
    expect(v.className).not.toContain('block-meeting');
    expect(v.locked).toBe(false);
    expect(v.icon).toBeNull();
    expect(v.chip).toBe('Blocked time');
  });

  it('an auto task is dashed, movable, no icon', () => {
    const v = blockVariant({ kind: 'task' });
    expect(v.className).toContain('block-task');
    expect(v.locked).toBe(false);
    expect(v.icon).toBeNull();
    expect(v.chip).toBe('Task · Auto-scheduled');
  });

  it('a pinned task stays dashed (movable style), gains a pin and a stronger fill', () => {
    const auto = blockVariant({ kind: 'task' });
    const v = blockVariant({ kind: 'task', pinned: true });
    expect(v.className).toContain('block-task');
    expect(v.className).not.toBe(auto.className); // the stronger fill
    expect(v.locked).toBe(false);
    expect(v.icon).toBe('pin');
    expect(v.chip).toBe('Task · Pinned');
  });

  it('habits use the habit look; pinned habits get the pin', () => {
    expect(blockVariant({ kind: 'habit' })).toMatchObject({ icon: null, chip: 'Habit · Movable', locked: false });
    expect(blockVariant({ kind: 'habit' }).className).toContain('block-habit');
    const pinned = blockVariant({ kind: 'habit', pinned: true });
    expect(pinned).toMatchObject({ icon: 'pin', chip: 'Habit · Pinned', locked: false });
    expect(pinned.className).toContain('block-habit');
  });

  it('a started task reads "In progress"', () => {
    expect(blockVariant({ kind: 'task', pinned: true, started: true }).chip).toBe('Task · In progress');
  });

  it('pins are never locks, whatever the kind', () => {
    for (const kind of ['task', 'habit'] as const) {
      expect(blockVariant({ kind, pinned: true }).locked).toBe(false);
    }
  });
});

describe('blockVariant category accent', () => {
  it('tints a movable task\'s border and text', () => {
    expect(blockVariant({ kind: 'task', accent: ACCENT }).style).toEqual({ borderColor: ACCENT, color: ACCENT });
  });

  it('a pinned task keeps the same border + text tint (pinned stays dashed, no fill colour)', () => {
    expect(blockVariant({ kind: 'task', pinned: true, accent: ACCENT }).style).toEqual({ borderColor: ACCENT, color: ACCENT });
  });

  it('meetings and blocked time ignore the accent', () => {
    expect(blockVariant({ kind: 'meeting', source: 'google', accent: ACCENT }).style).toEqual({});
    expect(blockVariant({ kind: 'blocked', source: 'app', accent: ACCENT }).style).toEqual({});
  });

  it('no accent → no inline style', () => {
    expect(blockVariant({ kind: 'task' }).style).toEqual({});
  });
});
