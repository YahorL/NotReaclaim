#!/usr/bin/env node
import crypto from 'node:crypto';
import { prisma, createUserRepository, createInviteCodeRepository, createSettingsRepository } from '@notreclaim/db';
import { hashPassword } from '../dist/auth/password.js';
import { ensureUserDefaults } from '../dist/auth/user-defaults.js';

const users = createUserRepository(prisma);
const invites = createInviteCodeRepository(prisma);
const settings = createSettingsRepository(prisma);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);
const norm = (e) => e.trim().toLowerCase();

const cmd = process.argv[2];
try {
  if (cmd === 'create-user') {
    const email = norm(arg('email'));
    const password = arg('password');
    const passwordHash = password ? await hashPassword(password) : null;
    const user = await users.create({ email, passwordHash, isAdmin: has('admin') });
    await ensureUserDefaults(settings, user.id);
    console.log(`created user ${user.id} <${email}>${has('admin') ? ' (admin)' : ''}${password ? '' : ' (google-only)'}`);
  } else if (cmd === 'set-password') {
    const user = await users.findByEmail(norm(arg('email')));
    if (!user) throw new Error('no such user');
    await users.update(user.id, { passwordHash: await hashPassword(arg('password')) });
    console.log(`password updated for ${user.email}`);
  } else if (cmd === 'create-invite') {
    const admin = await users.findByEmail(norm(arg('by') ?? arg('email') ?? '')) ?? (await firstAdmin());
    const code = crypto.randomBytes(9).toString('base64url');
    await invites.create({
      code,
      createdByUserId: admin.id,
      email: arg('email') ? norm(arg('email')) : null,
      maxUses: arg('max-uses') ? Number(arg('max-uses')) : 1,
      expiresAt: arg('expires') ? new Date(arg('expires')) : null,
    });
    console.log(`invite code: ${code}`);
  } else {
    console.log('usage: admin <create-user|set-password|create-invite> [--email] [--password] [--admin] [--max-uses] [--expires]');
  }
} finally {
  await prisma.$disconnect();
}

async function firstAdmin() {
  const a = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (!a) throw new Error('no admin user exists; run create-user --admin first');
  return a;
}
