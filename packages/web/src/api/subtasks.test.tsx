import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { useCreateSubtaskMutation } from './queries';

describe('subtask queries', () => {
  it('useCreateSubtaskMutation calls createSubtask and invalidates tasks', async () => {
    const createSubtask = vi.fn().mockResolvedValue({ id: 's1', taskId: 't1', title: 'a', done: false });
    const api = fakeApiClient({ createSubtask } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><ApiProvider client={api}>{children}</ApiProvider></QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateSubtaskMutation(), { wrapper });
    result.current.mutate({ taskId: 't1', title: 'a' });
    await waitFor(() => expect(createSubtask).toHaveBeenCalledWith({ taskId: 't1', title: 'a' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] }));
  });
});
