import { describe, it, expect, vi } from 'vitest';
import { createQueryClient } from './queryClient';
import { ApiError } from './client';

describe('createQueryClient', () => {
  it('calls onUnauthorized on a 401 ApiError from a query', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    await qc.fetchQuery({ queryKey: ['x'], queryFn: async () => { throw new ApiError(401, 'unauthorized', 'no'); } }).catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores non-401 ApiErrors and plain errors', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    await qc.fetchQuery({ queryKey: ['a'], queryFn: async () => { throw new ApiError(500, 'oops', 'server'); } }).catch(() => {});
    await qc.fetchQuery({ queryKey: ['b'], queryFn: async () => { throw new Error('network'); } }).catch(() => {});
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('also fires on a 401 from a mutation', async () => {
    const onUnauthorized = vi.fn();
    const qc = createQueryClient({ onUnauthorized });
    const mutation = qc.getMutationCache().build(qc, {
      mutationFn: async () => { throw new ApiError(401, 'unauthorized', 'no'); },
    });
    await mutation.execute(undefined).catch(() => {});
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
