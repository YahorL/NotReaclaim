import { describe, it, expect } from 'vitest';
import type { ScheduledBlock } from '../../api/types';
import { pickCurrentOrNext, isRunningBlock, trackingModeOf, nextBoundaryMs } from './currentOrNext';

const NOW = Date.parse('2026-06-11T12:00:00Z');

function block(over: Partial<ScheduledBlock> = {}): ScheduledBlock {
  return {
    id: 'b1', userId: 'u1', title: 'Write docs',
    startsAt: '2026-06-11T14:00:00Z', endsAt: '2026-06-11T15:00:00Z',
    taskId: 'task-1', habitId: null, pinned: false, engineKey: null, startedAt: null,
    ...over,
  };
}

describe('pickCurrentOrNext', () => {
  it('ignores blocks that are not task blocks', () => {
    const r = pickCurrentOrNext([block({ taskId: null })], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });

  it('picks the soonest un-started future task block as next', () => {
    const later = block({ id: 'late', startsAt: '2026-06-11T16:00:00Z', endsAt: '2026-06-11T17:00:00Z' });
    const sooner = block({ id: 'soon', startsAt: '2026-06-11T13:00:00Z', endsAt: '2026-06-11T13:30:00Z' });
    const r = pickCurrentOrNext([later, sooner], NOW);
    expect(r.nextBlock?.id).toBe('soon');
    expect(r.running).toBeNull();
  });

  it('ignores task blocks that already started in the past without being Started', () => {
    const r = pickCurrentOrNext([block({ startsAt: '2026-06-11T10:00:00Z', endsAt: '2026-06-11T11:00:00Z' })], NOW);
    expect(r.nextBlock).toBeNull();
  });

  it('prefers a started, unfinished block and suppresses next', () => {
    const started = block({ id: 'run', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z' });
    const r = pickCurrentOrNext([started, block()], NOW);
    expect(r.running?.id).toBe('run');
    expect(r.nextBlock).toBeNull();
  });

  it('treats a started block whose snapped start is slightly in the future as running', () => {
    const started = block({ id: 'snap', startsAt: '2026-06-11T12:15:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T12:10:00Z' });
    expect(pickCurrentOrNext([started], NOW).running?.id).toBe('snap');
  });

  it('drops a started block whose end has already passed', () => {
    const done = block({ id: 'done', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z', startedAt: '2026-06-11T09:00:00Z' });
    const r = pickCurrentOrNext([done], NOW);
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });
});

describe('trackingModeOf', () => {
  it('automatic only when the settings say requireStartToTrack: false (as the server decides)', () => {
    expect(trackingModeOf({ requireStartToTrack: false })).toBe('automatic');
    expect(trackingModeOf({ requireStartToTrack: true })).toBe('manual');
    // Not loaded yet / no settings row / field absent: today's (manual) rule.
    expect(trackingModeOf(undefined)).toBe('manual');
    expect(trackingModeOf({})).toBe('manual');
  });
});

describe('pickCurrentOrNext in AUTOMATIC tracking (U4)', () => {
  const auto = (over: Partial<ScheduledBlock>) => block({ startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z', ...over });

  it('a task block whose time has come is running, never Started and not pinned', () => {
    const r = pickCurrentOrNext([auto({ id: 'piece' }), block({ id: 'later' })], NOW, 'automatic');
    expect(r.running?.id).toBe('piece');
    expect(r.nextBlock).toBeNull(); // no "Next … Start" while something runs
  });

  it('manual tracking: the same block is neither running nor next (unchanged)', () => {
    const r = pickCurrentOrNext([auto({ id: 'piece' })], NOW, 'manual');
    expect(r.running).toBeNull();
    expect(r.nextBlock).toBeNull();
  });

  it('a hand-placed (pinned) block counts too', () => {
    expect(pickCurrentOrNext([auto({ id: 'p', pinned: true })], NOW, 'automatic').running?.id).toBe('p');
  });

  it('start is inclusive, end exclusive', () => {
    expect(pickCurrentOrNext([auto({ id: 's', startsAt: '2026-06-11T12:00:00Z' })], NOW, 'automatic').running?.id).toBe('s');
    expect(pickCurrentOrNext([auto({ id: 'e', endsAt: '2026-06-11T12:00:00Z' })], NOW, 'automatic').running).toBeNull();
  });

  it('habit blocks never run', () => {
    expect(pickCurrentOrNext([auto({ taskId: null, habitId: 'h1' })], NOW, 'automatic').running).toBeNull();
  });

  it('overlapping pieces: the one that started most recently', () => {
    const early = auto({ id: 'early', startsAt: '2026-06-11T11:00:00Z', endsAt: '2026-06-11T12:15:00Z' });
    const late = auto({ id: 'late', startsAt: '2026-06-11T11:45:00Z', endsAt: '2026-06-11T13:00:00Z' });
    expect(pickCurrentOrNext([early, late], NOW, 'automatic').running?.id).toBe('late');
    expect(pickCurrentOrNext([late, early], NOW, 'automatic').running?.id).toBe('late');
  });

  it('a just-Started block whose snapped start is a few minutes ahead still runs (else Start would be offered again)', () => {
    const started = block({ id: 'snap', startsAt: '2026-06-11T12:15:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T12:10:00Z' });
    expect(pickCurrentOrNext([started], NOW, 'automatic').running?.id).toBe('snap');
  });

  it('nothing running: next is the earliest task block still to come', () => {
    const r = pickCurrentOrNext([block({ id: 'b' }), auto({ id: 'past', startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z' })], NOW, 'automatic');
    expect(r.running).toBeNull();
    expect(r.nextBlock?.id).toBe('b');
  });
});

describe('isRunningBlock', () => {
  it('is the one rule behind the top bar, the detail card and the tile', () => {
    const piece = block({ startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' });
    expect(isRunningBlock(piece, NOW, 'automatic')).toBe(true);
    expect(isRunningBlock(piece, NOW, 'manual')).toBe(false);
    expect(isRunningBlock({ ...piece, startedAt: '2026-06-11T11:30:00Z' }, NOW, 'manual')).toBe(true);
  });
});

describe('nextBoundaryMs', () => {
  it('the next moment a task block starts or ends after now (when running / next can change), or null', () => {
    const a = block({ id: 'a', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' });
    const b = block({ id: 'b', startsAt: '2026-06-11T12:10:00Z', endsAt: '2026-06-11T13:00:00Z' });
    expect(nextBoundaryMs([a, b], NOW)).toBe(Date.parse('2026-06-11T12:10:00Z'));
    expect(nextBoundaryMs([a], NOW)).toBe(Date.parse('2026-06-11T12:30:00Z'));
    expect(nextBoundaryMs([block({ startsAt: '2026-06-11T09:00:00Z', endsAt: '2026-06-11T10:00:00Z' })], NOW)).toBeNull();
    expect(nextBoundaryMs([block({ taskId: null })], NOW)).toBeNull();
  });
});

describe('startNext: the next piece offered while one runs (W1)', () => {
  const running = block({ id: 'run', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' });
  const later = block({ id: 'later', startsAt: '2026-06-11T16:00:00Z', endsAt: '2026-06-11T17:00:00Z' });
  const soon = block({ id: 'soon', startsAt: '2026-06-11T13:00:00Z', endsAt: '2026-06-11T14:00:00Z' });

  it('automatic: the block the bar would show as Next if nothing ran, alongside the running one', () => {
    const r = pickCurrentOrNext([later, running, soon], NOW, 'automatic');
    expect(r.running?.id).toBe('run');
    expect(r.nextBlock).toBeNull(); // the primary control stays "Now … Stop"
    expect(r.startNext?.id).toBe('soon');
  });

  it('automatic: nothing to start next → null; a Started future block is not offered', () => {
    expect(pickCurrentOrNext([running], NOW, 'automatic').startNext).toBeNull();
    const startedSoon = { ...soon, startedAt: '2026-06-11T11:59:00Z' };
    expect(pickCurrentOrNext([running, startedSoon], NOW, 'automatic').startNext).toBeNull();
  });

  it('automatic, nothing running: no startNext (the primary Start covers it)', () => {
    const r = pickCurrentOrNext([soon], NOW, 'automatic');
    expect(r.nextBlock?.id).toBe('soon');
    expect(r.startNext).toBeNull();
  });

  it('manual: never offered (Start stays hidden while a Started block runs)', () => {
    const started = block({ id: 'run', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T13:00:00Z', startedAt: '2026-06-11T11:30:00Z' });
    const r = pickCurrentOrNext([started, soon], NOW, 'manual');
    expect(r.running?.id).toBe('run');
    expect(r.nextBlock).toBeNull();
    expect(r.startNext).toBeNull();
  });
});

describe('pinned behaviours (W8)', () => {
  it('isRunningBlock: a habit block is never running, in either mode, even inside its time or with startedAt', () => {
    const habit = block({ taskId: null, habitId: 'h1', startsAt: '2026-06-11T11:30:00Z', endsAt: '2026-06-11T12:30:00Z' });
    expect(isRunningBlock(habit, NOW, 'automatic')).toBe(false);
    expect(isRunningBlock({ ...habit, startedAt: '2026-06-11T11:30:00Z' }, NOW, 'manual')).toBe(false);
    expect(isRunningBlock({ ...habit, startedAt: '2026-06-11T11:30:00Z' }, NOW, 'automatic')).toBe(false);
  });

  it('manual overlaps keep today\'s order: of two Started running blocks, the one ending soonest', () => {
    const longer = block({ id: 'longer', startsAt: '2026-06-11T11:45:00Z', endsAt: '2026-06-11T14:00:00Z', startedAt: '2026-06-11T11:45:00Z' });
    const sooner = block({ id: 'sooner', startsAt: '2026-06-11T11:00:00Z', endsAt: '2026-06-11T12:30:00Z', startedAt: '2026-06-11T11:00:00Z' });
    expect(pickCurrentOrNext([longer, sooner], NOW, 'manual').running?.id).toBe('sooner');
    expect(pickCurrentOrNext([sooner, longer], NOW, 'manual').running?.id).toBe('sooner');
  });
});
