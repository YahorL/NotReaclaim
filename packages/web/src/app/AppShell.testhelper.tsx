/**
 * Test helper — renders AppShell inside the providers needed to test
 * sidebar pin/unpin without a real router outlet.
 */
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../api/ApiProvider';
import { AuthProvider } from '../auth/AuthContext';
import { fakeApiClient } from '../test/fakes';
import { AppShell } from './AppShell';

export function renderAppShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = fakeApiClient({ getSchedule: async () => [] });
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider client={api}>
        <MemoryRouter initialEntries={['/']}>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<AppShell />}>
                <Route index element={<div>planner</div>} />
              </Route>
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </ApiProvider>
    </QueryClientProvider>,
  );
}
