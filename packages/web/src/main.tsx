import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import { ApiProvider } from './api/ApiProvider';
import { AuthProvider } from './auth/AuthContext';
import { createApiClient } from './api/client';
import { createQueryClient } from './api/queryClient';
import { tokenStore } from './auth/tokenStore';
import './index.css';

const queryClient = createQueryClient({
  onUnauthorized: () => {
    tokenStore.clear();
    window.location.assign('/signin');
  },
});
const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  getToken: () => tokenStore.get()?.token ?? null,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={api}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </ApiProvider>
    </QueryClientProvider>
  </StrictMode>,
);
