import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Every API top-level path; keep in sync with packages/server/src/app.ts route registration and docker/Caddyfile (@api / @apiData).
      // Only the server's auth endpoints live under /auth/google; /auth/callback is a
      // client-side route (the redirect-with-token landing) and must NOT be proxied.
      '/auth/google': API,
      // Password-auth endpoints, listed exactly (mirrors docker/Caddyfile) rather than
      // as an '/auth' prefix, which would shadow /auth/callback on a full-page load.
      '/auth/login': API,
      '/auth/register': API,
      '/auth/set-password': API,
      '/auth/email': API,
      '/tasks': API,
      '/subtasks': API,
      '/habits': API,
      '/settings': API,
      '/schedule': API,
      '/calendar': API,
      '/categories': API,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
