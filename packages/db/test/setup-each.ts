import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/client.js';

const TABLES = [
  'ScheduledBlock',
  'CalendarEvent',
  'Task',
  'Habit',
  'Settings',
  'User',
];

beforeEach(async () => {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
});

afterAll(async () => {
  await prisma.$disconnect();
});
