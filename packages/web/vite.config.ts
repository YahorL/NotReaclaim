import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': API,
      '/tasks': API,
      '/habits': API,
      '/settings': API,
      '/schedule': API,
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
