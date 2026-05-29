import { execSync } from 'node:child_process';
import { config as loadEnv } from 'dotenv';

/** Runs once before the whole test run: apply migrations to the test DB. */
export default function setup(): void {
  loadEnv({ path: '.env.test' });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set (copy .env.test.example to .env.test)');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
