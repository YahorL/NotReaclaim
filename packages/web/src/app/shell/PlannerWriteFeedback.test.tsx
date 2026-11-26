import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../../api/ApiProvider';
import { ApiError } from '../../api/client';
import { fakeApiClient, gatewayError } from '../../test/fakes';
import { useCreateScheduledBlockMutation, useDeleteScheduledBlockMutation, useStartBlockMutation, useUpdateScheduledBlockMutation, useUpdateCalendarEventMutation } from '../../api/queries';
import { SAVE_FAILED_NO_RESPONSE } from '../lib/saveError';
import { ToastProvider } from './ToastProvider';
import { PlannerWriteFeedback, plannerWriteErrorText, BLOCK_REPLANNED_TEXT, TASK_GONE_TEXT, EVENT_GONE_TEXT } from './PlannerWriteFeedback';

const notFound = () => new ApiError(404, 'not_found', 'ScheduledBlock b1 not found');

describe('plannerWriteErrorText', () => {
  it.each(['blockUpdate', 'blockStart', 'blockStop'] as const)('a 404 on %s: the block was re-planned away while the edit waited', (op) => {
    expect(BLOCK_REPLANNED_TEXT).toBe("That block was re-planned while you were editing it. Your change wasn't applied.");
    expect(plannerWriteErrorText(op, notFound())).toBe(BLOCK_REPLANNED_TEXT);
  });

  it('a 404 on a drop: the task is gone', () => {
    expect(plannerWriteErrorText('blockCreate', new ApiError(404, 'not_found', 'Task t1 not found'))).toBe(TASK_GONE_TEXT);
  });

  it('a 404 on an event move: the event is gone', () => {
    expect(plannerWriteErrorText('eventUpdate', notFound())).toBe(EVENT_GONE_TEXT);
  });

  it.each(['blockDelete', 'eventDelete'] as const)('a 404 on %s says nothing: what the user wanted gone is gone', (op) => {
    expect(plannerWriteErrorText(op, notFound())).toBeNull();
  });

  it('anything else reads like every other failed save (saveErrorText)', async () => {
    expect(plannerWriteErrorText('blockUpdate', new TypeError('Failed to fetch'))).toBe(SAVE_FAILED_NO_RESPONSE);
    expect(plannerWriteErrorText('blockStart', await gatewayError(503))).toBe(SAVE_FAILED_NO_RESPONSE);
    expect(plannerWriteErrorText('blockStart', new ApiError(400, 'bad_request', 'Only task blocks can be started'))).toBe('Only task blocks can be started');
    expect(plannerWriteErrorText('blockDelete', new ApiError(500, 'internal_error', 'Internal Server Error'))).toBe('Internal Server Error');
  });
});

describe('PlannerWriteFeedback (shell toast for failed planner writes, from any surface)', () => {
  function setup(api = fakeApiClient()) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>
        <ApiProvider client={api}>
          <ToastProvider><PlannerWriteFeedback />{children}</ToastProvider>
        </ApiProvider>
      </QueryClientProvider>
    );
    return { qc, Wrapper };
  }

  it('a move answered 404 toasts the re-planned message in the polite status region', async () => {
    const { Wrapper } = setup(fakeApiClient({ updateScheduledBlock: vi.fn(async () => { throw notFound(); }) } as never));
    const { result } = renderHook(() => useUpdateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'b1', patch: { pinned: true } });
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(BLOCK_REPLANNED_TEXT));
    expect(screen.getByTestId('toast-region')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('toast')).toHaveAttribute('data-icon', 'warning');
  });

  it('a Start that never reached the server is not silent', async () => {
    const { Wrapper } = setup(fakeApiClient({ startBlock: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) } as never));
    const { result } = renderHook(() => useStartBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(SAVE_FAILED_NO_RESPONSE));
  });

  it('an app-event move answered 500 is not silent either', async () => {
    const { Wrapper } = setup(fakeApiClient({ updateCalendarEvent: vi.fn(async () => { throw new ApiError(500, 'internal_error', 'Internal Server Error'); }) } as never));
    const { result } = renderHook(() => useUpdateCalendarEventMutation(), { wrapper: Wrapper });
    result.current.mutate({ id: 'e1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent('Internal Server Error'));
  });

  it('no toast for a delete whose block was already gone (404)', async () => {
    const deleteScheduledBlock = vi.fn(async () => { throw notFound(); });
    const { Wrapper } = setup(fakeApiClient({ deleteScheduledBlock } as never));
    const { result } = renderHook(() => useDeleteScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate('b1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('no toast for a surface that shows the failure inline (the create popover)', async () => {
    const { Wrapper } = setup(fakeApiClient({ createScheduledBlock: vi.fn(async () => { throw new ApiError(400, 'bad_request', 'Bad slot'); }) } as never));
    const { result } = renderHook(() => useCreateScheduledBlockMutation({ inlineErrors: true }), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('a failed drop from the task panel (no inline surface) toasts', async () => {
    const { Wrapper } = setup(fakeApiClient({ createScheduledBlock: vi.fn(async () => { throw new ApiError(404, 'not_found', 'Task t1 not found'); }) } as never));
    const { result } = renderHook(() => useCreateScheduledBlockMutation(), { wrapper: Wrapper });
    result.current.mutate({ taskId: 't1', startsAt: 'S', endsAt: 'E' });
    await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(TASK_GONE_TEXT));
  });

  it('renders nothing itself', () => {
    const { Wrapper } = setup();
    const { container } = render(<span data-testid="x" />, { wrapper: Wrapper });
    expect(container.querySelector('[data-testid="x"]')).not.toBeNull();
  });
});
