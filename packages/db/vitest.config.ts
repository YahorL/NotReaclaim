import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.test' });
const databaseUrl = process.env.TEST_DATABASE_URL ?? '';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-each.ts'],
    env: {
      DATABASE_URL: databaseUrl,
    },
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
