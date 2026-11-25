import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SettingsInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { SettingsForm } from './SettingsForm';
import type { SettingsFormState } from './settingsForm';

const initial = (over: Partial<SettingsFormState> = {}): SettingsFormState => ({
  timezone: 'UTC',
  days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })),
  horizonDays: 14, defaultMinChunkMs: 1_800_000, defaultMaxChunkMs: 7_200_000,
  meetingBufferMs: 0, taskBufferMs: 0, requireStartToTrack: false, ...over,
});

describe('SettingsForm', () => {
  it('uses the full-size chunk steppers (screenshot 12), not the compact drawer variant', () => {
    render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} />);
    const steppers = screen.getAllByTestId('duration-stepper');
    expect(steppers).toHaveLength(2);
    for (const s of steppers) expect(s).not.toHaveAttribute('data-compact');
  });

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

  it('edits the planner day start and saves it as minutes past midnight', () => {
    const onSave = vi.fn();
    render(<SettingsForm initial={initial()} onSave={onSave} timezones={['UTC']} />);
    expect(screen.getByTestId('day-start')).toHaveValue('00:00');
    fireEvent.change(screen.getByTestId('day-start'), { target: { value: '03:00' } });
    fireEvent.click(screen.getByTestId('save'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dayStartMinute: 180 }));
  });

  it('shows ✓ Saved and surfaces an ApiError', () => {
    const { rerender } = render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} justSaved />);
    expect(screen.getByTestId('saved')).toBeInTheDocument();
    rerender(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} error={new ApiError(409, 'conflict', 'Nope')} />);
    expect(screen.getByTestId('form-error')).toHaveTextContent('Nope');
  });

  it('grows the weekday checkboxes on a coarse pointer', () => {
    render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} />);
    // The custom checkbox is 20px (h-5) everywhere now; a coarse pointer grows it to 24px.
    const toggle = screen.getByTestId('day-1-toggle');
    expect(toggle.className).toContain('coarse:h-6');
    expect(toggle.className).toContain('coarse:w-6');
    expect(toggle.parentElement!.className).toContain('coarse:py-2');
  });

  it('shows the weekly working-hours total and follows edits', () => {
    render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} />);
    expect(screen.getByTestId('weekly-total')).toHaveTextContent('40h per week'); // Mon–Fri 09:00–17:00
    fireEvent.click(screen.getByTestId('day-5-toggle'));
    expect(screen.getByTestId('weekly-total')).toHaveTextContent('32h per week');
    fireEvent.change(screen.getByTestId('day-1-end'), { target: { value: '17:30' } });
    expect(screen.getByTestId('weekly-total')).toHaveTextContent('32.5h per week');
  });

  it('groups the form into labelled cards with named controls', () => {
    render(<SettingsForm initial={initial()} onSave={vi.fn()} timezones={['UTC']} />);
    for (const name of ['Working hours', 'Timezone', 'Planner', 'Scheduling']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toBe(screen.getByTestId('timezone'));
    expect(screen.getByLabelText('Day starts at')).toBe(screen.getByTestId('day-start'));
    expect(screen.getByRole('spinbutton', { name: 'Planning horizon (days)' })).toBe(screen.getByTestId('horizon'));
    expect(screen.getByRole('checkbox', { name: 'Only count time after I press Start' })).toBe(screen.getByTestId('require-start'));
  });
});
