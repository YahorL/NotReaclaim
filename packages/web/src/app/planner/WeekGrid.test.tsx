import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ScheduledBlock, CalendarEvent } from '../../api/types';
import { startOfWeek, dayColumns, minutesToPx } from './weekModel';
import { blockLeftCss, blockWidthCss } from './blockLayout';
import { within } from '@testing-library/react';
import { WeekGrid, HOLD_TIMEOUT_MS, type WeekGridProps } from './WeekGrid';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

const MON = startOfWeek(Date.parse('2026-01-05T12:00:00.000Z'), 'UTC'); // 2026-01-05
const days = dayColumns(MON, 7, 'UTC');
const WED_NOON = Date.parse('2026-01-07T12:00:00.000Z');

/** The value a browser (and jsdom) serialises a `calc()` string back as — percentages are rounded. */
function cssCalc(value: string): string {
  const el = document.createElement('div');
  el.style.left = value;
  return el.style.left;
}

const block = (over: Partial<ScheduledBlock> = {}): ScheduledBlock => ({
  id: 'b1', userId: 'u1', title: 'Write spec',
  startsAt: '2026-01-05T13:00:00.000Z', endsAt: '2026-01-05T14:00:00.000Z',
  taskId: 't1', habitId: null, pinned: false, engineKey: 'task:t1:0', ...over,
});
const event = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e1', userId: 'u1', title: 'Standup',
  startsAt: '2026-01-07T10:00:00.000Z', endsAt: '2026-01-07T10:30:00.000Z',
  googleCalendarId: 'primary', googleEventId: 'g1', source: 'google', ...over,
});

function renderGrid(props: Partial<WeekGridProps> = {}) {
  return render(
    <WeekGrid
      days={days}
      nowMs={WED_NOON}
      weekLabel="Jan 5 – 11"
      blocks={[block()]}
      events={[event()]}
      onPrev={vi.fn()}
      onToday={vi.fn()}
      onNext={vi.fn()}
      onCommit={vi.fn()}
      {...props}
    />,
  );
}

function renderGridWithProviders(props: Partial<WeekGridProps> = {}, api = fakeApiClient()) {
  return renderWithProviders(
    <WeekGrid
      days={days} nowMs={WED_NOON} weekLabel="Jan 5 – 11"
      blocks={[block()]} events={[event()]}
      onPrev={vi.fn()} onToday={vi.fn()} onNext={vi.fn()} onCommit={vi.fn()}
      {...props}
    />,
    { api },
  );
}

describe('WeekGrid click-to-create', () => {
  it('clicking empty column space opens the popover at the snapped slot', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    // jsdom: rect height 0 → fraction 0 → slot starts at the 00:00 window top
    // The slot label renders in locale 12-hour format (e.g. "12:00 AM") or 24-hour format ("00:00")
    expect(screen.getByTestId('slot-label').textContent).toMatch(/12:00 AM|00:00/);
  });

  it('the popover renders in the block layer, above the blocks', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    const slot = within(screen.getByTestId('block-layer')).getByTestId('col-slot-2');
    expect(slot.contains(screen.getByTestId('create-popover'))).toBe(true);
    expect(slot.className).toContain('z-30');
    // The slot passes clicks through; the popover itself takes them.
    expect(slot.className).toContain('pointer-events-none');
    expect(screen.getByTestId('create-popover').className).toContain('pointer-events-auto');
  });

  it('clicking an existing block does not open the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getAllByTestId('event-block')[0]!);
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });

  it('Escape closes the popover', () => {
    renderGridWithProviders();
    fireEvent.click(screen.getByTestId('day-col-2'), { clientY: 0 });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('create-popover')).not.toBeInTheDocument();
  });
});

describe('WeekGrid', () => {
  it('places a meeting and a task block in their day columns', () => {
    renderGrid();
    const blocks = screen.getAllByTestId('event-block');
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'meeting' && b.textContent?.includes('Standup'))).toBe(true);
    expect(blocks.some((b) => b.getAttribute('data-kind') === 'task' && b.textContent?.includes('Write spec'))).toBe(true);
  });

  it('highlights today', () => {
    renderGrid();
    const todayHeader = screen.getByTestId('day-header-2'); // index 2 = Wednesday
    expect(todayHeader).toHaveAttribute('data-today', 'true');
  });

  it('renders a now-line on today', () => {
    renderGrid();
    const line = screen.getByTestId('now-line');
    expect(line).toHaveAttribute('data-day-index', '2');
    expect(line.style.top).toBe('50%'); // Wed 12:00
    expect(line.style.left).toBe(`${(2 / 7) * 100}%`);
  });

  it('renders every block in ONE layer over the day columns', () => {
    renderGrid();
    const layer = screen.getByTestId('block-layer');
    const tiles = screen.getAllByTestId('event-block');
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => layer.contains(t))).toBe(true);
    for (let i = 0; i < 7; i++) expect(within(screen.getByTestId(`day-col-${i}`)).queryByTestId('event-block')).toBeNull();
    // Hit-testing contract: the layer lets clicks through to the columns; each block opts back in.
    expect(layer.className).toContain('pointer-events-none');
    expect(tiles.every((t) => t.className.includes('pointer-events-auto'))).toBe(true);
  });

  it('positions a block horizontally in its day column via blockLayout', () => {
    renderGrid({ events: [] });
    const tile = screen.getByTestId('event-block'); // Mon 13:00 → column 0 of 7
    expect(tile).toHaveAttribute('data-day-index', '0');
    expect(tile.style.top).toBe(`${(13 / 24) * 100}%`);
    expect(tile.style.left).toBe(cssCalc(blockLeftCss(0, 0, 1)));
    expect(tile.style.width).toBe(cssCalc(blockWidthCss(100 / 7, 0, 1)));
  });

  it('a Wednesday meeting sits in the third column of the layer', () => {
    renderGrid({ blocks: [] });
    const tile = screen.getByTestId('event-block');
    expect(tile).toHaveAttribute('data-day-index', '2');
    expect(tile.style.left).toBe(cssCalc(blockLeftCss((2 / 7) * 100, 0, 1)));
  });

  it('a Google meeting is locked: lock icon, no resize handle', () => {
    renderGrid({ blocks: [] });
    const tile = screen.getByTestId('event-block');
    expect(tile).toHaveAttribute('data-locked', 'true');
    expect(tile).toHaveAttribute('data-source', 'google');
    expect(tile.querySelector('[data-icon="lock"]')).not.toBeNull();
    expect(tile.querySelector('[data-testid="resize-handle"]')).toBeNull();
  });

  it('keeps a stable, day-independent child order in the layer', () => {
    // A cross-day move must not reorder the layer's children (React would re-insert the node).
    const a = block({ id: 'a', title: 'A', startsAt: '2026-01-09T09:00:00.000Z', endsAt: '2026-01-09T10:00:00.000Z' });
    const b = block({ id: 'b', title: 'B', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T10:00:00.000Z' });
    const { rerender } = renderGrid({ blocks: [a, b], events: [] });
    const names = () => screen.getAllByTestId('block-body').map((t) => t.getAttribute('aria-label')!.split(',')[0]);
    const before = names();
    rerender(
      <WeekGrid days={days} nowMs={WED_NOON} weekLabel="Jan 5 – 11" events={[]}
        blocks={[{ ...a, startsAt: '2026-01-05T11:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z' }, b]}
        onPrev={vi.fn()} onToday={vi.fn()} onNext={vi.fn()} onCommit={vi.fn()} />,
    );
    expect(names()).toEqual(before);
  });

  it('tints today\'s column', () => {
    renderGrid();
    expect(screen.getByTestId('day-col-2')).toHaveAttribute('data-today', 'true');
    expect(screen.getByTestId('day-col-1')).not.toHaveAttribute('data-today');
  });

  it('fires nav callbacks', () => {
    const onPrev = vi.fn(); const onNext = vi.fn(); const onToday = vi.fn();
    renderGrid({ onPrev, onNext, onToday });
    fireEvent.click(screen.getByRole('button', { name: /^previous$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    fireEvent.click(screen.getByRole('button', { name: /today/i }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('threads accent to a task block when accents map is provided', () => {
    // block() has taskId:'t1', provide accent for t1
    renderGrid({ accents: { t1: '#5b62e3' } });
    // The task block should receive the accent → borderColor inline style
    const taskBlock = screen.getAllByTestId('event-block').find(
      (b) => b.getAttribute('data-kind') === 'task',
    )!;
    expect(taskBlock.style.borderColor).toBe('rgb(91, 98, 227)');
  });

  it('no accents → task block has no inline borderColor', () => {
    renderGrid();
    const taskBlock = screen.getAllByTestId('event-block').find(
      (b) => b.getAttribute('data-kind') === 'task',
    )!;
    expect(taskBlock.style.borderColor).toBe('');
  });

  it('delete on a task block calls onDeleteBlock with the block id', () => {
    const onDeleteBlock = vi.fn();
    renderGrid({ onDeleteBlock });
    const btn = screen.getByRole('button', { name: /delete block/i, hidden: true });
    fireEvent.click(btn);
    expect(onDeleteBlock).toHaveBeenCalledWith('b1');
  });

  it('delete on a calendar event calls onDeleteEvent with the event id', () => {
    const onDeleteEvent = vi.fn();
    renderGrid({ onDeleteEvent });
    const btn = screen.getByRole('button', { name: /delete event/i, hidden: true });
    fireEvent.click(btn);
    expect(onDeleteEvent).toHaveBeenCalledWith('e1');
  });

  it('registers a drop zone spanning each day column', () => {
    renderGrid();
    const zone = screen.getByTestId('day-drop-0');
    expect(screen.getByTestId('day-col-0').contains(zone)).toBe(true);
    // Rect maths only: the zone must never eat the column's click-to-create tap.
    expect(zone.className).toContain('pointer-events-none');
    expect(zone.className).toContain('absolute');
    expect(zone.className).toContain('inset-0');
  });

  it('renders the drop indicator from the taskDrop prop and highlights that column', () => {
    renderGrid({ taskDrop: { dayIndex: 1, startMin: 360 } });
    const indicator = screen.getByTestId('task-drop-indicator');
    expect(indicator.style.top).toBe('25%'); // 06:00 of a 24h column
    expect(screen.getByTestId('day-col-1')).toHaveAttribute('data-drop-target', 'true');
    expect(screen.getByTestId('day-col-0')).not.toHaveAttribute('data-drop-target');
    // Drawn above the blocks: in the block layer's column-1 slot, not under it in the column.
    expect(within(screen.getByTestId('block-layer')).getByTestId('col-slot-1').contains(indicator)).toBe(true);
  });

  it('puts the hour grid in a scroll container, below the day header', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    expect(scroller.className).toMatch(/overflow-y-auto/);
    // day headers are OUTSIDE the scroll container (they stay pinned)
    expect(scroller.querySelector('[data-testid="day-header-0"]')).toBeNull();
    expect(screen.getByTestId('day-header-0')).toBeInTheDocument();
    // hour rows / day columns ARE inside the scroller
    expect(scroller.querySelector('[data-testid="day-col-0"]')).not.toBeNull();
  });

  it('renders one column per day for a 3-day window and has no horizontal-scroll wrapper', () => {
    const days = [
      new Date('2026-01-07T00:00:00.000Z').getTime(),
      new Date('2026-01-08T00:00:00.000Z').getTime(),
      new Date('2026-01-09T00:00:00.000Z').getTime(),
    ];
    renderGrid({ days }); // 3-day window starting Wed 2026-01-07
    expect(screen.getByTestId('day-col-0')).toBeInTheDocument();
    expect(screen.getByTestId('day-col-2')).toBeInTheDocument();
    expect(screen.queryByTestId('day-col-3')).toBeNull();
    // day labels follow the actual dates (today-anchored), not fixed Mon-first
    expect(screen.getByTestId('day-header-0').textContent).toMatch(/Wed/);
  });

  it('rotates the hour gutter and keeps late-night work on the previous date column (day start 03:00)', () => {
    const cols = dayColumns(Date.parse('2026-01-05T12:00:00.000Z'), 3, 'UTC', 180); // Jan 5/6/7 at 03:00
    const lateNight = block({ id: 'ln', title: 'Late night', startsAt: '2026-01-07T01:00:00.000Z', endsAt: '2026-01-07T02:00:00.000Z' });
    renderGrid({
      days: cols, dayStartMinute: 180, blocks: [lateNight], events: [],
      nowMs: Date.parse('2026-01-07T01:30:00.000Z'),
    });
    // gutter runs 3a → 2a
    const gutter = screen.getByTestId('hour-gutter').textContent!;
    expect(gutter.startsWith('3a4a5a')).toBe(true);
    expect(gutter.endsWith('1a2a')).toBe(true);
    // 01:00 on the 7th belongs to the 6th's column, 22h down
    const tile = within(screen.getByTestId('block-layer')).getByTestId('event-block');
    expect(tile.textContent).toMatch(/Late night/);
    expect(tile).toHaveAttribute('data-day-index', '1');
    expect(tile.style.top).toBe(`${(22 * 60 / 1440) * 100}%`);
    // ...and that column is "today" at 01:30
    expect(screen.getByTestId('day-header-1').dataset.today).toBe('true');
    expect(screen.getByTestId('day-header-1').textContent).toMatch(/6/);
    expect(screen.getByTestId('now-line')).toHaveAttribute('data-day-index', '1');
  });

  it('labels a block in the provided timezone', () => {
    const day = new Date('2026-06-18T04:00:00.000Z').getTime(); // NY midnight
    const blocks = [block({ id: 'b1', title: 'Morning', startsAt: '2026-06-18T13:00:00.000Z', endsAt: '2026-06-18T14:00:00.000Z' })];
    renderGrid({ days: [day], blocks, nowMs: Date.parse('2026-06-18T16:00:00.000Z'), zone: 'America/New_York' });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Morning'))!;
    expect(tile.textContent).toMatch(/(^|[^0-9])9:00 AM/); // 13:00Z = 9am EDT, no leading zero
  });

  it('renders two overlapping blocks side-by-side at half width', () => {
    const day = new Date('2026-01-05T00:00:00.000Z').getTime();
    const blocks = [
      block({ id: 'o1', title: 'A', startsAt: '2026-01-05T09:00:00.000Z', endsAt: '2026-01-05T11:00:00.000Z' }),
      block({ id: 'o2', title: 'B', startsAt: '2026-01-05T10:00:00.000Z', endsAt: '2026-01-05T12:00:00.000Z' }),
    ];
    renderGrid({ days: [day], blocks, events: [], nowMs: Date.parse('2026-01-05T08:00:00.000Z') });
    const tiles = screen.getAllByTestId('event-block');
    expect(tiles).toHaveLength(2);
    expect(tiles.every((t) => /width:\s*calc\(50%/.test(t.getAttribute('style') || ''))).toBe(true);
  });

  // These three live here, not in the compact describe: they exercise the `coarse` pointer prop
  // and the default (fine-pointer) grid, neither of which has anything to do with the sub-md
  // compact layout.
  it('keeps a rubber-band scroll inside the hours grid', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    expect(scroller.className).toContain('overscroll-contain');
    // …but only on a phone: `md+` keeps native scroll chaining, so desktop is unchanged.
    expect(scroller.className).toContain('md:overscroll-auto');
  });

  // md+: a click or tap selects the block (detail card); below md a tap opens the drawer.
  it('below md a tap on a task block opens its task', () => {
    const onEditTask = vi.fn();
    const onSelect = vi.fn();
    renderGrid({ compact: true, coarse: true, onEditTask, onSelect, days: [days[0]!] });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(onEditTask).toHaveBeenCalledWith('t1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('at md+ a click on a task block selects it instead of opening the drawer', () => {
    const onEditTask = vi.fn();
    const onSelect = vi.fn();
    renderGrid({ onEditTask, onSelect });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith('b:b1', { keyboard: false });
    expect(onEditTask).not.toHaveBeenCalled();
  });

  it('at md+ a coarse tap (iPad) selects too', () => {
    const onEditTask = vi.fn();
    const onSelect = vi.fn();
    renderGrid({ coarse: true, onEditTask, onSelect });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    expect(onSelect).toHaveBeenCalledWith('b:b1', { keyboard: false });
    expect(onEditTask).not.toHaveBeenCalled();
  });

  it('a real drag does not select', () => {
    const onSelect = vi.fn();
    const onCommit = vi.fn();
    renderGrid({ onSelect, onCommit });
    const tile = screen.getAllByTestId('event-block').find((b) => b.textContent?.includes('Write spec'))!;
    fireEvent.pointerDown(tile, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(tile, { clientX: 40, clientY: 80 + minutesToPx(60), pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 40, clientY: 80 + minutesToPx(60), pointerId: 1 });
    // …and the native click a browser may fire after the drag (detail 1) is ignored too.
    fireEvent.click(within(tile).getByTestId('block-body'), { detail: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter on a block body selects it, flagged as keyboard', () => {
    const onSelect = vi.fn();
    renderGrid({ onSelect });
    const body = screen.getAllByTestId('block-body').find((b) => b.getAttribute('aria-label')?.startsWith('Write spec'))!;
    fireEvent.click(body, { detail: 0 }); // what a browser fires for Enter / Space on a button
    expect(onSelect).toHaveBeenCalledWith('b:b1', { keyboard: true });
  });

  it('a click on a (static) Google meeting selects it', () => {
    const onSelect = vi.fn();
    renderGrid({ onSelect, blocks: [] });
    fireEvent.click(screen.getByTestId('block-body'), { detail: 1 });
    expect(onSelect).toHaveBeenCalledWith('e:e1', { keyboard: false });
  });

  it('every block body is reachable with Tab (a focusable button)', () => {
    renderGrid();
    const bodies = screen.getAllByTestId('block-body');
    expect(bodies).toHaveLength(2);
    for (const b of bodies) {
      expect(b.tagName).toBe('BUTTON');
      expect(b).not.toHaveAttribute('tabindex', '-1');
    }
  });

  it('outlines the selected block', () => {
    renderGrid({ selectedKey: 'b:b1' });
    const tiles = screen.getAllByTestId('event-block');
    expect(tiles.find((t) => t.textContent?.includes('Write spec'))).toHaveAttribute('data-selected', 'true');
    expect(tiles.find((t) => t.textContent?.includes('Standup'))).toHaveAttribute('data-selected', 'false');
  });

});

describe('WeekGrid held release target (no jump, rollback springs home)', () => {
  const PX_60 = minutesToPx(60);
  const base = { days, nowMs: WED_NOON, weekLabel: 'Jan 5 – 11', events: [] as CalendarEvent[], onPrev: vi.fn(), onToday: vi.fn(), onNext: vi.fn() };
  const top = (hour: number) => `${(hour / 24) * 100}%`;
  const tile = () => screen.getByTestId('event-block');
  const dragDownAnHour = () => {
    fireEvent.pointerDown(tile(), { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerMove(tile(), { clientX: 40, clientY: 80 + PX_60, pointerId: 1 });
    fireEvent.pointerUp(tile(), { clientX: 40, clientY: 80 + PX_60, pointerId: 1 });
  };

  it('the release render already shows the target slot, with no transform', () => {
    const onCommit = vi.fn();
    render(<WeekGrid {...base} blocks={[block()]} onCommit={onCommit} />);
    expect(tile().style.top).toBe(top(13));
    dragDownAnHour();
    expect(onCommit).toHaveBeenCalledWith('b1', { startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T15:00:00.000Z', pinned: true });
    // The data has not changed yet, but the tile is already in its new slot.
    expect(tile().style.top).toBe(top(14));
    expect(tile().style.transform).toBe('');
    expect(tile()).toHaveAttribute('data-settling', 'true');
  });

  it('keeps the target once the data agrees, and after the hold window', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<WeekGrid {...base} blocks={[block()]} onCommit={vi.fn()} />);
      dragDownAnHour();
      rerender(<WeekGrid {...base} blocks={[block({ startsAt: '2026-01-05T14:00:00.000Z', endsAt: '2026-01-05T15:00:00.000Z', pinned: true })]} onCommit={vi.fn()} />);
      expect(tile().style.top).toBe(top(14));
      act(() => { vi.advanceTimersByTime(HOLD_TIMEOUT_MS + 10); });
      expect(tile().style.top).toBe(top(14));
    } finally {
      vi.useRealTimers();
    }
  });

  it('springs back to the data when the write never lands (rolled back / failed)', () => {
    vi.useFakeTimers();
    try {
      render(<WeekGrid {...base} blocks={[block()]} onCommit={vi.fn()} />);
      dragDownAnHour();
      expect(tile().style.top).toBe(top(14));
      act(() => { vi.advanceTimersByTime(HOLD_TIMEOUT_MS + 10); });
      expect(tile().style.top).toBe(top(13));
      expect(tile().className).toContain('[transition:top_var(--dur-move)_var(--ease-spring)');
    } finally {
      vi.useRealTimers();
    }
  });

  it('the data wins when the server put the block somewhere else', () => {
    const { rerender } = render(<WeekGrid {...base} blocks={[block()]} onCommit={vi.fn()} />);
    dragDownAnHour();
    rerender(<WeekGrid {...base} blocks={[block({ startsAt: '2026-01-05T16:00:00.000Z', endsAt: '2026-01-05T17:00:00.000Z' })]} onCommit={vi.fn()} />);
    expect(tile().style.top).toBe(top(16));
  });

  it('a cross-day release moves the same element to the new column (stable key, no re-insert)', () => {
    render(<WeekGrid {...base} blocks={[block()]} onCommit={vi.fn()} />);
    const layer = screen.getByTestId('block-layer');
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({ width: 840, height: 1440, top: 0, left: 0, right: 840, bottom: 1440, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const before = tile();
    fireEvent.pointerDown(before, { clientX: 40, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(before, { clientX: 40 + 2 * 120, clientY: 80, pointerId: 1 });
    expect(tile()).toBe(before);
    expect(tile()).toHaveAttribute('data-day-index', '2');
    expect(tile().style.left).toBe(cssCalc(blockLeftCss((2 / 7) * 100, 0, 1)));
  });
});

describe('WeekGrid app-created events', () => {
  const PX_PER_60MIN = minutesToPx(60);
  const appEvent = event({ id: 'e9', title: 'Coffee', source: 'app', googleCalendarId: null, googleEventId: null });
  const tileFor = (title: string) => screen.getAllByTestId('event-block').find((b) => b.textContent?.includes(title))!;

  it('renders an app-created event as an interactive block (resize handle present)', () => {
    renderGrid({ events: [appEvent] });
    expect(tileFor('Coffee').querySelector('[data-testid="resize-handle"]')).not.toBeNull();
  });

  it('a google-source event stays static (no resize handle, no drag)', () => {
    const onCommitEvent = vi.fn();
    renderGrid({ events: [event()], onCommitEvent });
    const tile = tileFor('Standup');
    expect(tile.querySelector('[data-testid="resize-handle"]')).toBeNull();
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommitEvent).not.toHaveBeenCalled();
  });

  it('dragging an app event down an hour commits the new ISO times via onCommitEvent', () => {
    const onCommitEvent = vi.fn();
    renderGrid({ events: [appEvent], onCommitEvent });
    const tile = tileFor('Coffee');
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(tile, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommitEvent).toHaveBeenCalledWith('e9', {
      startsAt: '2026-01-07T11:00:00.000Z', endsAt: '2026-01-07T11:30:00.000Z',
    });
  });

  it('below md, tapping an app event (no drag) calls onEditEvent with the event', () => {
    const onEditEvent = vi.fn();
    const onCommitEvent = vi.fn();
    renderGrid({ events: [appEvent], onEditEvent, onCommitEvent, compact: true });
    const tile = tileFor('Coffee');
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onEditEvent).toHaveBeenCalledWith(appEvent);
    expect(onCommitEvent).not.toHaveBeenCalled();
  });

  it('delete on an app event still calls onDeleteEvent with the event id', () => {
    const onDeleteEvent = vi.fn();
    renderGrid({ events: [appEvent], blocks: [], onDeleteEvent });
    fireEvent.click(screen.getByRole('button', { name: /delete event/i, hidden: true }));
    expect(onDeleteEvent).toHaveBeenCalledWith('e9');
  });
});

describe('WeekGrid blocked time', () => {
  const PX_PER_60MIN = minutesToPx(60);
  const blockedEvent = event({
    id: 'e7', title: 'Gym', kind: 'blocked', source: 'app', googleCalendarId: null, googleEventId: null,
  });
  const tileFor = (title: string) => screen.getAllByTestId('event-block').find((b) => b.textContent?.includes(title))!;

  it('renders a blocked entry muted, not as a blue meeting', () => {
    renderGrid({ events: [blockedEvent], blocks: [] });
    const tile = tileFor('Gym');
    expect(tile).toHaveAttribute('data-kind', 'blocked');
    expect(tile).toHaveAttribute('data-locked', 'false');
    expect(tile.querySelector('[data-icon="lock"]')).toBeNull();
  });

  it('a blocked entry stays interactive: drag commits new times via onCommitEvent', () => {
    const onCommitEvent = vi.fn();
    renderGrid({ events: [blockedEvent], blocks: [], onCommitEvent });
    const tile = tileFor('Gym');
    expect(tile.querySelector('[data-testid="resize-handle"]')).not.toBeNull();
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(tile, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100 + PX_PER_60MIN, pointerId: 1 });
    expect(onCommitEvent).toHaveBeenCalledWith('e7', {
      startsAt: '2026-01-07T11:00:00.000Z', endsAt: '2026-01-07T11:30:00.000Z',
    });
  });

  it('below md, tapping a blocked entry opens the editor, and its × deletes it', () => {
    const onEditEvent = vi.fn();
    const onDeleteEvent = vi.fn();
    renderGrid({ events: [blockedEvent], blocks: [], onEditEvent, onDeleteEvent, compact: true });
    const tile = tileFor('Gym');
    fireEvent.pointerDown(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(tile, { clientX: 50, clientY: 100, pointerId: 1 });
    expect(onEditEvent).toHaveBeenCalledWith(blockedEvent);
    fireEvent.click(screen.getByRole('button', { name: /delete event/i, hidden: true }));
    expect(onDeleteEvent).toHaveBeenCalledWith('e7');
  });
});

describe('WeekGrid compact (below md)', () => {
  it('uses the 44px gutter when compact and the 64px gutter otherwise', () => {
    const { unmount } = renderGrid({ days: [days[0]!], compact: true });
    expect(screen.getByTestId('day-header-row').style.gridTemplateColumns).toMatch(/^44px /);
    unmount();
    renderGrid({ days: [days[0]!] });
    expect(screen.getByTestId('day-header-row').style.gridTemplateColumns).toMatch(/^64px /);
  });

  it('sizes the hours-scroll from the flex chain, not a chrome constant', () => {
    renderGrid();
    const scroller = screen.getByTestId('hours-scroll');
    expect(scroller.className).toContain('flex-1');
    expect(scroller.className).toContain('min-h-[240px]');
    // Load-bearing negative assertion: this used to be `max-h-[calc(100dvh - Npx)]`, and every
    // chrome change (mobile top bar, tab bar, a wrapped toolbar, the unscheduled banner) made
    // the constant wrong on some viewport. Measured 136.5px of grid under the tab bar at
    // 390×844. Sizing now flows from Planner's `h-full` down the flex chain — if this fails,
    // the fix is to repair the chain, NOT to bump a new constant back in.
    expect(scroller.className).not.toContain('max-h-[calc(');
    expect(scroller.getAttribute('style')).toBeNull();
  });

  it('keeps the flex chain that gives the hours-scroll its height', () => {
    const { container } = renderGrid();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('min-h-0');
    expect(root.className).toContain('flex-1');
    // The card wrapper (parent of the day header) must pass the height through, and the
    // toolbar / day header must not absorb it.
    const card = screen.getByTestId('day-header-row').parentElement as HTMLElement;
    expect(card.className).toContain('min-h-0');
    expect(card.className).toContain('flex-1');
    expect(screen.getByTestId('day-header-row').className).toContain('shrink-0');
  });

  it('keeps the desktop toolbar on one row', () => {
    renderGrid();
    const toolbar = screen.getByText('Today').parentElement as HTMLElement;
    // Compact is allowed to wrap; md must not (a wrapped desktop toolbar measured 86px/2 rows).
    expect(toolbar.className).toContain('flex-wrap');
    expect(toolbar.className).toContain('md:flex-nowrap');
    // Nowrap makes the row's items shrinkable instead of wrappable, so the ones that must keep
    // their geometry say so; the legend is the only element left to give (it clips to one line).
    // (Re-plan moved to the summary card above the grid; UnscheduledCard pins its shrink-0.)
    expect(screen.queryByRole('button', { name: /re-plan/i })).toBeNull();
    expect(screen.getByText('Today').className).toContain('shrink-0');
    expect(screen.getByText('Jan 5 – 11').className).toContain('md:shrink-0');
    const legend = screen.getByTestId('grid-legend');
    expect(legend.className).toContain('min-w-0');
    expect(legend.className).toContain('overflow-hidden');
    expect(legend.className).toContain('max-h-[22px]');
  });

  it('hides the legend below md', () => {
    renderGrid();
    const legend = screen.getByTestId('grid-legend');
    expect(legend.className).toContain('hidden');
    expect(legend.className).toContain('md:flex');
  });

  it('compact swaps the panel toggle for a Tasks sheet button', () => {
    const onTogglePanel = vi.fn();
    renderGrid({ compact: true, onTogglePanel, panelHidden: false });
    expect(screen.queryByTestId('panel-hide')).toBeNull();
    const toggle = screen.getByTestId('panel-sheet-toggle');
    fireEvent.click(toggle);
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });

  it('desktop keeps the panel hide/show toggle', () => {
    renderGrid({ onTogglePanel: vi.fn(), panelHidden: false });
    expect(screen.getByTestId('panel-hide')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-sheet-toggle')).toBeNull();
  });

  // Below md the create form is a dismissible Sheet, so the column-anchored align no longer
  // applies (popoverAlign itself stays covered in weekModel.test).
  it('opens the create form inside a dismissible sheet, hoisted out of the day column', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    const dialog = screen.getByRole('dialog', { name: 'New entry' });
    expect(within(dialog).getByTestId('create-popover')).toBeInTheDocument();
    // Hoisted: a backdrop rendered inside the column would bubble its dismissing click straight
    // back into the column's click-to-create handler.
    expect(within(screen.getByTestId('day-col-0')).queryByTestId('create-popover')).toBeNull();
  });

  it('a backdrop tap dismisses the create sheet without re-opening it at another slot', () => {
    // The user's report, end to end: the form opened at a slot and could not be closed, because
    // its own outside-dismiss unmounted it before the tap's click, which then hit the column
    // underneath and re-opened it at a different slot.
    const createCalendarEvent = vi.fn(async () => ({ id: 'e-never' }));
    renderGridWithProviders({ days: [days[0]!], compact: true }, fakeApiClient({ createCalendarEvent } as never));
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    expect(screen.getByTestId('create-popover')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByTestId('create-popover')).toBeNull();
    expect(screen.queryByTestId('sheet-backdrop')).toBeNull();
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  it('the create sheet closes on its ✕ and on Escape', () => {
    renderGridWithProviders({ days: [days[0]!], compact: true });
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    fireEvent.click(screen.getByTestId('sheet-close'));
    expect(screen.queryByTestId('create-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('day-col-0'), { clientY: 0 });
    // Escape is the DIALOG's own keystroke (it holds focus), never the document's — a document
    // listener would dismiss a sheet sitting under a stacked modal.
    fireEvent.keyDown(screen.getByTestId('sheet'), { key: 'Escape' });
    expect(screen.queryByTestId('create-popover')).toBeNull();
  });

  it('swiping the day header left pages forward and right pages back', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderGrid({ compact: true, onNext, onPrev });
    const header = screen.getByTestId('day-header-row');
    fireEvent.touchStart(header, { touches: [{ clientX: 300, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 120, clientY: 24 }] });
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.touchStart(header, { touches: [{ clientX: 120, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 300, clientY: 24 }] });
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('a mostly-vertical drag on the header does not page', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    renderGrid({ compact: true, onNext, onPrev });
    const header = screen.getByTestId('day-header-row');
    fireEvent.touchStart(header, { touches: [{ clientX: 300, clientY: 20 }] });
    fireEvent.touchEnd(header, { changedTouches: [{ clientX: 240, clientY: 320 }] });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrev).not.toHaveBeenCalled();
  });

});
