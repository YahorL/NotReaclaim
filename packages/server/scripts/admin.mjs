#!/usr/bin/env node
import crypto from 'node:crypto';
import { prisma, createUserRepository, createInviteCodeRepository, createSettingsRepository } from '@notreclaim/db';
import { hashPassword } from '../dist/auth/password.js';
import { ensureUserDefaults } from '../dist/auth/user-defaults.js';
import { parseAdminArgs, resolveInviter, ADMIN_USAGE } from '../dist/admin-cli.js';

const users = createUserRepository(prisma);
const invites = createInviteCodeRepository(prisma);
const settings = createSettingsRepository(prisma);

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
    // Runtime failures (no such user, duplicate email, no admin) are one line, not a trace.
    console.error(`admin: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function run(args) {
  if (args.kind === 'create-user') {
    const { email, password, admin } = args;
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await users.create({ email, passwordHash, isAdmin: admin });
    await ensureUserDefaults(settings, user.id);
    console.log(`created user ${user.id} <${email}>${admin ? ' (admin)' : ''}${password ? '' : ' (google-only)'}`);
  } else if (args.kind === 'set-password') {
    const user = await users.findByEmail(args.email);
    if (!user) throw new Error('no such user');
    await users.update(user.id, { passwordHash: await hashPassword(args.password) });
    console.log(`password updated for ${user.email}`);
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
  const a = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (!a) throw new Error('no admin user exists; run create-user --admin first');
  return a;
}
