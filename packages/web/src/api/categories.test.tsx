import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from './ApiProvider';
import { fakeApiClient } from '../test/fakes';
import { useCategoriesQuery, useCreateCategoryMutation } from './queries';

function wrap(api: ReturnType<typeof fakeApiClient>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}><ApiProvider client={api}>{children}</ApiProvider></QueryClientProvider>
  );
}

describe('category queries', () => {
  it('useCategoriesQuery lists categories', async () => {
    const api = fakeApiClient({ listCategories: vi.fn().mockResolvedValue([{ id: 'c1', userId: 'u', name: 'Working Hours', windows: null, isDefault: true }]) } as never);
    const { result } = renderHook(() => useCategoriesQuery(), { wrapper: wrap(api) });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data![0]!.name).toBe('Working Hours');
  });

  it('useCreateCategoryMutation calls createCategory and invalidates categories + schedule', async () => {
    const createCategory = vi.fn().mockResolvedValue({ id: 'c2', userId: 'u', name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }], isDefault: false });
    const api = fakeApiClient({ createCategory } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}><ApiProvider client={api}>{children}</ApiProvider></QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateCategoryMutation(), { wrapper });
    result.current.mutate({ name: 'Personal', windows: [{ weekday: 1, startMinute: 1080, endMinute: 1320 }] });
    await waitFor(() => expect(createCategory).toHaveBeenCalled());
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: ['categories'] });
      expect(spy).toHaveBeenCalledWith({ queryKey: ['schedule'] });
    });
  });
});
