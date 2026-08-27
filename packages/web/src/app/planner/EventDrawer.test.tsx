import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { CalendarEvent } from '../../api/types';
import { EventDrawer } from './EventDrawer';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';

const appEvent = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'e9', userId: 'u1', title: 'Coffee',
  startsAt: '2026-01-07T15:00:00.000Z', endsAt: '2026-01-07T15:30:00.000Z',
  googleCalendarId: null, googleEventId: null, source: 'app', ...over,
});

const api = (over = {}) => fakeApiClient({
  updateCalendarEvent: vi.fn(async () => appEvent()),
  deleteCalendarEvent: vi.fn(async () => undefined),
  ...over,
} as never);

describe('EventDrawer', () => {
  it('prefills title/date/start/end in the settings timezone (not the browser zone)', () => {
    renderWithProviders(<EventDrawer event={appEvent()} zone="America/New_York" onClose={vi.fn()} />, { api: api() });
    expect(screen.getByTestId('event-title')).toHaveValue('Coffee');
    // 15:00Z on 2026-01-07 is 10:00 in New York (EST, UTC-5)
    expect(screen.getByTestId('event-start')).toHaveValue('2026-01-07T10:00');
    expect(screen.getByTestId('event-end')).toHaveValue('2026-01-07T10:30');
  });

  it('Save submits only the changed fields (plus the id) and closes', async () => {
    const onClose = vi.fn();
    const updateCalendarEvent = vi.fn(async () => appEvent());
    renderWithProviders(
      <EventDrawer event={appEvent()} zone="UTC" onClose={onClose} />,
      { api: api({ updateCalendarEvent }) },
    );
    fireEvent.change(screen.getByTestId('event-title'), { target: { value: 'Coffee chat' } });
    fireEvent.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledTimes(1));
    expect(updateCalendarEvent).toHaveBeenCalledWith('e9', { title: 'Coffee chat' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a title-only save leaves the times alone even in the DST fall-back ambiguous hour', async () => {
    // 2026-11-01T06:30Z is 01:30 in New York *after* the fall-back (EST, UTC-5); re-parsing
    // "2026-11-01T01:30" resolves the repeated wall time to the earlier offset (EDT, 05:30Z),
    // so an instant comparison would wrongly report the untouched times as edited.
    const updateCalendarEvent = vi.fn(async () => appEvent());
    const ambiguous = appEvent({ startsAt: '2026-11-01T06:30:00.000Z', endsAt: '2026-11-01T07:00:00.000Z' });
    renderWithProviders(
      <EventDrawer event={ambiguous} zone="America/New_York" onClose={vi.fn()} />,
      { api: api({ updateCalendarEvent }) },
    );
    expect(screen.getByTestId('event-start')).toHaveValue('2026-11-01T01:30');
    fireEvent.change(screen.getByTestId('event-title'), { target: { value: 'Coffee chat' } });
    fireEvent.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledTimes(1));
    expect(updateCalendarEvent).toHaveBeenCalledWith('e9', { title: 'Coffee chat' });
  });

  it('a title-only save leaves the times alone when the event has seconds precision', async () => {
    const updateCalendarEvent = vi.fn(async () => appEvent());
    const withSeconds = appEvent({ startsAt: '2026-01-07T15:00:37.000Z', endsAt: '2026-01-07T15:30:37.000Z' });
    renderWithProviders(
      <EventDrawer event={withSeconds} zone="UTC" onClose={vi.fn()} />,
      { api: api({ updateCalendarEvent }) },
    );
    fireEvent.change(screen.getByTestId('event-title'), { target: { value: 'Coffee chat' } });
    fireEvent.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledTimes(1));
    expect(updateCalendarEvent).toHaveBeenCalledWith('e9', { title: 'Coffee chat' });
  });

  it('Save converts edited times back from the settings timezone to ISO instants', async () => {
    const updateCalendarEvent = vi.fn(async () => appEvent());
    renderWithProviders(
      <EventDrawer event={appEvent()} zone="America/New_York" onClose={vi.fn()} />,
      { api: api({ updateCalendarEvent }) },
    );
    fireEvent.change(screen.getByTestId('event-start'), { target: { value: '2026-01-07T11:00' } });
    fireEvent.change(screen.getByTestId('event-end'), { target: { value: '2026-01-07T12:00' } });
    fireEvent.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledTimes(1));
    expect(updateCalendarEvent).toHaveBeenCalledWith('e9', {
      startsAt: '2026-01-07T16:00:00.000Z',
      endsAt: '2026-01-07T17:00:00.000Z',
    });
  });

  it('Delete calls the delete mutation and closes', async () => {
    const onClose = vi.fn();
    const deleteCalendarEvent = vi.fn(async () => undefined);
    renderWithProviders(
      <EventDrawer event={appEvent()} zone="UTC" onClose={onClose} />,
      { api: api({ deleteCalendarEvent }) },
    );
    fireEvent.click(screen.getByTestId('event-delete'));
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith('e9'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on a mousedown outside the drawer, but not inside it', () => {
    const onClose = vi.fn();
    renderWithProviders(<EventDrawer event={appEvent()} zone="UTC" onClose={onClose} />, { api: api() });
    fireEvent.mouseDown(screen.getByTestId('event-drawer'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables Save when the end is at or before the start', () => {
    const updateCalendarEvent = vi.fn(async () => appEvent());
    renderWithProviders(
      <EventDrawer event={appEvent()} zone="UTC" onClose={vi.fn()} />,
      { api: api({ updateCalendarEvent }) },
    );
    fireEvent.change(screen.getByTestId('event-end'), { target: { value: '2026-01-07T15:00' } });
    expect(screen.getByTestId('event-save')).toBeDisabled();
    fireEvent.click(screen.getByTestId('event-save'));
    expect(updateCalendarEvent).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-range')).toBeInTheDocument();
  });

  it('disables Save when the title is empty', () => {
    renderWithProviders(<EventDrawer event={appEvent()} zone="UTC" onClose={vi.fn()} />, { api: api() });
    fireEvent.change(screen.getByTestId('event-title'), { target: { value: '   ' } });
    expect(screen.getByTestId('event-save')).toBeDisabled();
  });

  it('edits a blocked entry like any app event (type is not editable here)', async () => {
    const onClose = vi.fn();
    const updateCalendarEvent = vi.fn(async () => appEvent());
    const blocked = appEvent({ id: 'e-b', title: 'Gym', kind: 'blocked' });
    renderWithProviders(
      <EventDrawer event={blocked} zone="UTC" onClose={onClose} />,
      { api: api({ updateCalendarEvent }) },
    );
    expect(screen.getByTestId('event-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('event-title')).toHaveValue('Gym');
    fireEvent.change(screen.getByTestId('event-end'), { target: { value: '2026-01-07T16:30' } });
    fireEvent.click(screen.getByTestId('event-save'));
    await waitFor(() => expect(updateCalendarEvent).toHaveBeenCalledWith('e-b', { endsAt: '2026-01-07T16:30:00.000Z' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('deletes a blocked entry', async () => {
    const deleteCalendarEvent = vi.fn(async () => undefined);
    renderWithProviders(
      <EventDrawer event={appEvent({ id: 'e-b', title: 'Gym', kind: 'blocked' })} zone="UTC" onClose={vi.fn()} />,
      { api: api({ deleteCalendarEvent }) },
    );
    fireEvent.click(screen.getByTestId('event-delete'));
    await waitFor(() => expect(deleteCalendarEvent).toHaveBeenCalledWith('e-b'));
  });

  it('renders nothing for a google-owned event', () => {
    renderWithProviders(
      <EventDrawer event={appEvent({ source: 'google', googleEventId: 'g1' })} zone="UTC" onClose={vi.fn()} />,
      { api: api() },
    );
    expect(screen.queryByTestId('event-drawer')).toBeNull();
  });

  it('compact drops the fixed 440px panel chrome and its own outside-dismiss', () => {
    const onClose = vi.fn();
    renderWithProviders(<EventDrawer event={appEvent()} compact onClose={onClose} />, { api: api() });
    const drawer = screen.getByTestId('event-drawer');
    expect(drawer.className).toContain('w-full');
    expect(drawer.className).not.toContain('w-[440px]');
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
