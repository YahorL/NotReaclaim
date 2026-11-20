import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders, fakeApiClient } from '../../test/fakes';
import { NewTaskModal } from '../shell/NewTaskModal';
import { CreatePopover } from '../planner/CreatePopover';

// In a real browser a non-empty date field fails to convert only in a zone its Intl does not know
// (jsdom empties unparseable datetime-local values, and luxon shifts gap times instead of failing).
// The modal and the popover read the zone from useTimezone / the planner, which never hand them an
// unsupported zone, so this file makes ONE wall-clock unconvertible to reach the guard itself.
const POISON = '2026-01-09T09:00';
vi.mock('../lib/datetimeLocal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/datetimeLocal')>();
  return {
    ...actual,
    zonedInputToIso: (local: string, zone: string) => (local === POISON ? null : actual.zonedInputToIso(local, zone)),
  };
});

const NOW = Date.parse('2026-01-05T00:00:00.000Z');

describe('NewTaskModal: a date that does not convert', () => {
  it('flags Schedule after and blocks Create instead of creating without it', () => {
    const createTask = vi.fn();
    const api = fakeApiClient({ createTask, getSettings: vi.fn(() => Promise.reject(new Error('404'))) } as never);
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.change(screen.getByTestId('schedule-after'), { target: { value: POISON } });
    expect(screen.getByTestId('err-notBeforeLocal')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: /^create$/i });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('flags the due date the same way', () => {
    const api = fakeApiClient({ getSettings: vi.fn(() => Promise.reject(new Error('404'))) } as never);
    renderWithProviders(<NewTaskModal now={() => NOW} onClose={vi.fn()} />, { api });
    fireEvent.change(screen.getByPlaceholderText(/task name/i), { target: { value: 'Write' } });
    fireEvent.change(screen.getByTestId('due-date'), { target: { value: POISON } });
    expect(screen.getByTestId('err-dueByLocal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });
});

describe('CreatePopover: a Schedule after that does not convert', () => {
  it('flags it and blocks Create instead of dropping it from the payload', () => {
    const createTask = vi.fn();
    const props = { dayStartMs: NOW, startMin: 540, topPct: 18.75, onClose: vi.fn(), now: () => NOW, zone: 'UTC' };
    renderWithProviders(<CreatePopover {...props} />, { api: fakeApiClient({ createTask } as never) });
    fireEvent.click(screen.getByTestId('mode-task'));
    fireEvent.change(screen.getByTestId('create-title'), { target: { value: 'Focus' } });
    fireEvent.change(screen.getByTestId('create-after'), { target: { value: POISON } });
    expect(screen.getByTestId('create-after-error')).toBeInTheDocument();
    expect(screen.getByTestId('create-submit')).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId('create-title'), { key: 'Enter' });
    expect(createTask).not.toHaveBeenCalled();
  });
});
