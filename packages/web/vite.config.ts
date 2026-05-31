import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Only the server's auth endpoints live under /auth/google; /auth/callback is a
      // client-side route (the redirect-with-token landing) and must NOT be proxied.
      '/auth/google': API,
      '/tasks': API,
      '/habits': API,
      '/settings': API,
      '/schedule': API,
      '/calendar': API,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
