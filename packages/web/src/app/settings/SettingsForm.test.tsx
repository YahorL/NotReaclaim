import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SettingsInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { SettingsForm } from './SettingsForm';
import { defaultFormState, type SettingsFormState } from './settingsForm';

const initial = (over: Partial<SettingsFormState> = {}): SettingsFormState => ({
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, ...over,
});

describe('SettingsForm', () => {
  it('saves the converted input with off days omitted', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC', 'America/New_York']} />);
    fireEvent.click(screen.getByTestId('save'));
    const input = onSave.mock.calls[0]![0] as SettingsInput;
    expect(input.timezone).toBe('UTC');
    expect(input.horizonDays).toBe(14);
    expect(input.workingHours).toHaveLength(5);
    expect(input.workingHours[0]).toEqual({ weekday: 1, startMinute: 540, endMinute: 1020 });
  });

  it('toggling a day off omits it from the saved input', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC']} />);
    fireEvent.click(screen.getByTestId('day-1-toggle'));
    fireEvent.click(screen.getByTestId('save'));
    const input = onSave.mock.calls[0]![0] as SettingsInput;
    expect(input.workingHours).toHaveLength(4);
    expect(input.workingHours.some((w) => w.weekday === 1)).toBe(false);
  });

  it('blocks save and shows a per-day error when end <= start', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC']} />);
    fireEvent.change(screen.getByTestId('day-1-end'), { target: { value: '08:00' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('err-day-1')).toBeInTheDocument();
  });

  it('reflects a timezone change in the saved input', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC', 'America/New_York']} />);
    fireEvent.change(screen.getByTestId('timezone'), { target: { value: 'America/New_York' } });
    fireEvent.click(screen.getByTestId('save'));
    expect((onSave.mock.calls[0]![0] as SettingsInput).timezone).toBe('America/New_York');
  });

  it('toggles requireStartToTrack and includes it on save', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={{ ...initial(), requireStartToTrack: false }} onSave={onSave} timezones={['UTC']} />);
    fireEvent.click(screen.getByTestId('require-start'));
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ requireStartToTrack: true }));
  });

  it('shows ✓ Saved and surfaces an ApiError', () => {
    const { rerender } = render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} justSaved />);
    expect(screen.getByTestId('saved')).toBeInTheDocument();
    rerender(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} error={new ApiError(409, 'conflict', 'Nope')} />);
    expect(screen.getByTestId('form-error')).toHaveTextContent('Nope');
  });

});
