import { z } from 'zod';

/**
 * Pure argument handling for `scripts/admin.mjs` (which imports this from `dist/`): every
 * bad invocation becomes a one-line message for a usage error instead of a stack trace,
 * and nothing here touches the database.
 */

export const ADMIN_USAGE = [
  'usage: admin <command> [flags]',
  '  create-user   --email <e> [--password <p>] [--admin]',
  '  set-password  --email <e> --password <p>',
  '  create-invite [--email <invitee>] [--by <issuer email>] [--max-uses <n>] [--expires <date>]',
  '                (--email binds the code to that invitee; the issuer defaults to the first admin)',
].join('\n');

export type ParsedAdminArgs =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'create-user'; email: string; password: string | undefined; admin: boolean }
  | { kind: 'set-password'; email: string; password: string }
  | { kind: 'create-invite'; email: string | null; by: string | undefined; maxUses: number; expiresAt: Date | null };

/** Allowed flags per command: `true` takes a value, `false` is a boolean switch. */
const FLAGS = {
  'create-user': { email: true, password: true, admin: false },
  'set-password': { email: true, password: true },
  'create-invite': { email: true, by: true, 'max-uses': true, expires: true },
} as const satisfies Record<string, Record<string, boolean>>;
type Command = keyof typeof FLAGS;

class UsageError extends Error {}

const emailSchema = z.string().email();
const norm = (e: string): string => e.trim().toLowerCase();

function email(flag: string, raw: string): string {
  const value = norm(raw);
  if (!emailSchema.safeParse(value).success) throw new UsageError(`--${flag} must be an email address`);
  return value;
}

function required(values: Map<string, string>, flag: string): string {
  const value = values.get(flag);
  if (value === undefined) throw new UsageError(`--${flag} is required`);
  return value;
}

/** Parse `process.argv.slice(2)`. */
export function parseAdminArgs(argv: readonly string[]): ParsedAdminArgs {
  const [cmd, ...rest] = argv;
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return { kind: 'help' };
  if (cmd === undefined) return { kind: 'error', message: 'missing command' };
  if (!Object.hasOwn(FLAGS, cmd)) return { kind: 'error', message: `unknown command: ${cmd}` };
  const command = cmd as Command;
  const allowed: Record<string, boolean> = FLAGS[command];

  try {
    const values = new Map<string, string>();
    const switches = new Set<string>();
    for (let i = 0; i < rest.length; i += 1) {
      const token = rest[i]!;
      if (!token.startsWith('--')) throw new UsageError(`unexpected argument: ${token}`);
      const name = token.slice(2);
      if (!Object.hasOwn(allowed, name)) throw new UsageError(`unknown flag --${name} for ${command}`);
      if (values.has(name) || switches.has(name)) throw new UsageError(`--${name} given more than once`);
      if (!allowed[name]) {
        switches.add(name);
        continue;
      }
      const value = rest[i + 1];
      if (value === undefined || value === '' || value.startsWith('--')) throw new UsageError(`--${name} requires a value`);
      values.set(name, value);
      i += 1;
    }

    switch (command) {
      case 'create-user':
        return {
          kind: 'create-user',
          email: email('email', required(values, 'email')),
          password: values.get('password'),
          admin: switches.has('admin'),
        };
      case 'set-password':
        return {
          kind: 'set-password',
          email: email('email', required(values, 'email')),
          password: required(values, 'password'),
        };
      case 'create-invite': {
        const rawMaxUses = values.get('max-uses');
        const maxUses = rawMaxUses === undefined ? 1 : Number(rawMaxUses);
        if (!Number.isInteger(maxUses) || maxUses < 1) throw new UsageError('--max-uses must be a positive integer');
        const rawExpires = values.get('expires');
        const expiresAt = rawExpires === undefined ? null : new Date(rawExpires);
        if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new UsageError('--expires must be a date (e.g. 2027-01-31)');
        const rawEmail = values.get('email');
        const rawBy = values.get('by');
        return {
          kind: 'create-invite',
          email: rawEmail === undefined ? null : email('email', rawEmail),
          by: rawBy === undefined ? undefined : email('by', rawBy),
          maxUses,
          expiresAt,
        };
      }
    }
  } catch (err) {
    if (err instanceof UsageError) return { kind: 'error', message: err.message };
    throw err;
  }
}

/**
 * Who issues an invite (InviteCode.createdByUserId). `email` is the INVITEE the code is
 * bound to (tryConsume matches on it), so it is never a candidate for the issuer.
 */
export async function resolveInviter<U>(
  opts: { email: string | null; by: string | undefined },
  lookup: { findByEmail(email: string): Promise<U | null>; firstAdmin(): Promise<U> },
): Promise<U> {
  if (opts.by === undefined) return lookup.firstAdmin();
  const issuer = await lookup.findByEmail(opts.by);
  // A typo'd --by used to fall back silently to the first admin: say so instead.
  if (!issuer) throw new Error(`no user with --by email ${opts.by}`);
  return issuer;
}
