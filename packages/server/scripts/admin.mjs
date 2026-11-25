#!/usr/bin/env node
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { prisma, createUserRepository, createInviteCodeRepository, createSettingsRepository } from '@notreclaim/db';
import { hashPassword } from '../dist/auth/password.js';
import { ensureUserDefaults } from '../dist/auth/user-defaults.js';
import {
  parseAdminArgs, resolveInviter, resolvePassword, runDeleteUser, pickFirstAdmin, defaultAdminTimezone,
  AdminInputError, ADMIN_USAGE,
} from '../dist/admin-cli.js';

const users = createUserRepository(prisma);
const invites = createInviteCodeRepository(prisma);
const settings = createSettingsRepository(prisma);

const isTTY = process.stdin.isTTY === true;

/**
 * Ask on the terminal. Prompts go to stderr so stdout carries only results. `hidden` mutes the
 * echo (readline in terminal mode echoes through `output`, which is then a sink). Ctrl-C and
 * Ctrl-D reject instead of leaving the promise pending (top-level await would exit 13).
 */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve, reject) => {
    const output = hidden ? new Writable({ write(_chunk, _enc, cb) { cb(); } }) : process.stderr;
    if (hidden) process.stderr.write(question);
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    let answered = false;
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      if (hidden) process.stderr.write('\n');
      if (!answered) reject(new AdminInputError('cancelled'));
    });
    rl.question(hidden ? '' : question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
  });
}

async function readStdin() {
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const passwordIO = {
  isTTY,
  promptHidden: (question) => ask(question, { hidden: true }),
  readStdin,
  warn: (message) => console.error(message),
};

// Validate everything before touching the database: a bad invocation prints usage, no stack.
const parsed = parseAdminArgs(process.argv.slice(2));
if (parsed.kind === 'help') {
  console.log(ADMIN_USAGE);
} else if (parsed.kind === 'error') {
  console.error(`admin: ${parsed.message}\n${ADMIN_USAGE}`);
  process.exitCode = 2;
} else {
  try {
    await run(parsed);
  } catch (err) {
    // Runtime failures (no such user, duplicate email, no admin) are one line, not a trace;
    // a bad password or missing confirmation is a bad invocation (exit 2, like usage errors).
    console.error(`admin: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = err instanceof AdminInputError ? 2 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function run(args) {
  if (args.kind === 'create-user') {
    const { email, admin, googleOnly } = args;
    // Asked for before any query, so a bad password never leaves a half-created account.
    const password = googleOnly ? null : await resolvePassword(args.password, passwordIO);
    const timezone = args.timezone ?? defaultAdminTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await users.create({ email, passwordHash, isAdmin: admin });
    await ensureUserDefaults(settings, user.id, timezone);
    console.log(`created user ${user.id} <${email}>${admin ? ' (admin)' : ''}${password ? '' : ' (google-only)'}, time zone ${timezone}`);
  } else if (args.kind === 'set-password') {
    const user = await users.findByEmail(args.email);
    if (!user) throw new Error('no such user');
    const password = await resolvePassword(args.password, passwordIO);
    await users.update(user.id, { passwordHash: await hashPassword(password) });
    console.log(`password updated for ${user.email}`);
  } else if (args.kind === 'delete-user') {
    await runDeleteUser(args, {
      findByEmail: (e) => users.findByEmail(e),
      countAdmins: () => prisma.user.count({ where: { isAdmin: true } }),
      countOwned: async (userId) => {
        const [tasks, habits, blocks, events, issued] = await Promise.all([
          prisma.task.count({ where: { userId } }),
          prisma.habit.count({ where: { userId } }),
          prisma.scheduledBlock.count({ where: { userId } }),
          prisma.calendarEvent.count({ where: { userId } }),
          prisma.inviteCode.count({ where: { createdByUserId: userId } }),
        ]);
        return { tasks, habits, blocks, events, invites: issued };
      },
      // Every relation to User is onDelete: Cascade, so one delete removes all owned rows.
      deleteUser: async (id) => { await prisma.user.delete({ where: { id } }); },
      isTTY,
      prompt: (question) => ask(question),
      print: (line) => console.log(line),
    });
  } else if (args.kind === 'create-invite') {
    const issuer = await resolveInviter(args, { findByEmail: (e) => users.findByEmail(e), firstAdmin });
    const code = crypto.randomBytes(9).toString('base64url');
    await invites.create({
      code,
      createdByUserId: issuer.id,
      email: args.email,
      maxUses: args.maxUses,
      expiresAt: args.expiresAt,
    });
    console.log(`invite code: ${code}`);
  }
}

async function firstAdmin() {
  const a = pickFirstAdmin(await prisma.user.findMany({ where: { isAdmin: true } }));
  if (!a) throw new Error('no admin user exists; run create-user --admin first');
  return a;
}
