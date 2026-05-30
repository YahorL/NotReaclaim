import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './client';

export interface QueryClientOptions {
  onUnauthorized: () => void;
}

export function createQueryClient({ onUnauthorized }: QueryClientOptions): QueryClient {
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401) onUnauthorized();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { retry: false } },
  });
}
