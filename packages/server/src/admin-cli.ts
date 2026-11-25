import { z } from 'zod';
import { isValidTimezone } from '@notreclaim/core';

/**
 * Argument handling and decision logic for `scripts/admin.mjs` (which imports this from
 * `dist/`): every bad invocation becomes a one-line message for a usage error instead of a
 * stack trace. Nothing here touches the database or the terminal directly — those are
 * injected, so the logic is unit-tested.
 */

export const MIN_PASSWORD_LENGTH = 8;

export const ADMIN_USAGE = [
  'usage: admin <command> [flags]',
  '  create-user   --email <e> [--admin] [--timezone <IANA zone>] [--google-only]',
  '                (asks for the password on a terminal, or reads one line from stdin;',
  '                 --google-only: no password, signs in with Google only;',
  '                 --timezone defaults to the server\'s own zone, else UTC)',
  '  set-password  --email <e>   (password asked for / read from stdin, as above)',
  '  delete-user   --email <e> [--yes]',
  '                (shows what will be deleted and asks you to type the email again;',
  '                 --yes skips that and is required when not on a terminal)',
  '  create-invite [--email <invitee>] [--by <issuer email>] [--max-uses <n>] [--expires <date>]',
  '                (--email binds the code to that invitee; the issuer defaults to the first admin)',
  `  Passwords need at least ${MIN_PASSWORD_LENGTH} characters. --password <p> is still accepted by create-user`,
  '  and set-password, but it is visible in shell history and the process list.',
].join('\n');

export type ParsedAdminArgs =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  // `password` is the argv value; undefined = ask for it (see resolvePassword). `googleOnly` and
  // `timezone` are present only when given.
  | { kind: 'create-user'; email: string; password: string | undefined; admin: boolean; googleOnly?: true; timezone?: string }
  | { kind: 'set-password'; email: string; password: string | undefined }
  | { kind: 'delete-user'; email: string; yes: boolean }
  | { kind: 'create-invite'; email: string | null; by: string | undefined; maxUses: number; expiresAt: Date | null };

/** Allowed flags per command: `true` takes a value, `false` is a boolean switch. */
const FLAGS = {
  'create-user': { email: true, password: true, admin: false, timezone: true, 'google-only': false },
  'set-password': { email: true, password: true },
  'delete-user': { email: true, yes: false },
  'create-invite': { email: true, by: true, 'max-uses': true, expires: true },
} as const satisfies Record<string, Record<string, boolean>>;
type Command = keyof typeof FLAGS;

class UsageError extends Error {}

/** A bad invocation found after parsing (password, confirmation): exit 2 like a usage error. */
export class AdminInputError extends Error {}

const emailSchema = z.string().email();
export const norm = (e: string): string => e.trim().toLowerCase();

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
      case 'create-user': {
        const googleOnly = switches.has('google-only');
        if (googleOnly && values.has('password')) throw new UsageError('--google-only and --password cannot be combined');
        const timezone = values.get('timezone');
        if (timezone !== undefined && !isValidTimezone(timezone)) {
          throw new UsageError('--timezone must be an IANA time zone (e.g. Europe/Berlin)');
        }
        return {
          kind: 'create-user',
          email: email('email', required(values, 'email')),
          password: values.get('password'),
          admin: switches.has('admin'),
          ...(googleOnly ? { googleOnly: true as const } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
        };
      }
      case 'set-password':
        return {
          kind: 'set-password',
          email: email('email', required(values, 'email')),
          password: values.get('password'),
        };
      case 'delete-user':
        return { kind: 'delete-user', email: email('email', required(values, 'email')), yes: switches.has('yes') };
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

/**
 * The issuer used when create-invite has no --by: the oldest admin, ties broken by id, so the
 * choice does not depend on the database's row order. null when there is no admin.
 */
export function pickFirstAdmin<U extends { id: string; isAdmin: boolean; createdAt: Date }>(users: readonly U[]): U | null {
  let first: U | null = null;
  for (const u of users) {
    if (!u.isAdmin) continue;
    if (!first || u.createdAt.getTime() < first.createdAt.getTime()
      || (u.createdAt.getTime() === first.createdAt.getTime() && u.id < first.id)) {
      first = u;
    }
  }
  return first;
}

/** New accounts get the server process's own zone when it is a valid IANA zone, else UTC. */
export function defaultAdminTimezone(processZone: string | undefined): string {
  return processZone && isValidTimezone(processZone) ? processZone : 'UTC';
}

export const ARGV_PASSWORD_WARNING =
  'admin: warning: --password is visible in shell history and the process list; omit it to be asked (or pipe it on stdin)';

/** Terminal / stdin access for resolvePassword (injected so the logic is testable). */
export interface PasswordIO {
  /** stdin is an interactive terminal. */
  isTTY: boolean;
  /** Ask on the terminal without echoing what is typed. */
  promptHidden(question: string): Promise<string>;
  /** All of (piped) stdin as text. */
  readStdin(): Promise<string>;
  /** One line to stderr. */
  warn(message: string): void;
}

/**
 * The password for create-user / set-password: `--password` from argv (kept for old scripts,
 * with a warning), else asked twice without echo on a terminal, else the first line of piped
 * stdin. Only the line ending is stripped — spaces are part of the password. Every source must
 * give at least MIN_PASSWORD_LENGTH characters; an empty stdin is an error, never "no password".
 */
export async function resolvePassword(argvPassword: string | undefined, io: PasswordIO): Promise<string> {
  let password: string;
  if (argvPassword !== undefined) {
    io.warn(ARGV_PASSWORD_WARNING);
    password = argvPassword;
  } else if (io.isTTY) {
    password = await io.promptHidden('Password: ');
    const again = await io.promptHidden('Repeat password: ');
    if (password !== again) throw new AdminInputError('the passwords do not match');
  } else {
    password = (await io.readStdin()).split(/\r?\n/)[0] ?? '';
    if (password === '') {
      throw new AdminInputError('no password given: run in a terminal to be asked, or pipe it on stdin');
    }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminInputError(`the password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return password;
}

export interface DeleteUserCounts {
  tasks: number;
  habits: number;
  blocks: number;
  events: number;
  invites: number;
}

export interface DeleteUserDeps {
  findByEmail(email: string): Promise<{ id: string; email: string; isAdmin: boolean } | null>;
  countAdmins(): Promise<number>;
  countOwned(userId: string): Promise<DeleteUserCounts>;
  /** Deletes the user; every owned row goes with it (onDelete: Cascade throughout the schema). */
  deleteUser(userId: string): Promise<void>;
  isTTY: boolean;
  /** Ask on the terminal (echoed). */
  prompt(question: string): Promise<string>;
  /** One line of output. */
  print(line: string): void;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * delete-user: refuse the last admin, show what goes, then confirm — by retyping the email on a
 * terminal, or `--yes` (required off a terminal) — and delete. Only NotReclaim's own data is
 * removed: the user's Google Calendar events and their Google grant are left alone.
 */
export async function runDeleteUser(args: { email: string; yes: boolean }, deps: DeleteUserDeps): Promise<void> {
  const user = await deps.findByEmail(args.email);
  if (!user) throw new Error('no such user');
  if (user.isAdmin && (await deps.countAdmins()) <= 1) {
    throw new Error(`refusing to delete ${user.email}: it is the last admin`);
  }
  const c = await deps.countOwned(user.id);
  deps.print(`This deletes user ${user.email}${user.isAdmin ? ' (admin)' : ''} and everything it owns in NotReclaim:`);
  deps.print(`  ${plural(c.tasks, 'task')}, ${plural(c.habits, 'habit')}, ${plural(c.blocks, 'scheduled block')}, `
    + `${plural(c.events, 'calendar event')}, ${plural(c.invites, 'invite code')} it issued, its settings and categories.`);
  deps.print('  Its Google Calendar events (including blocks NotReclaim wrote there) are NOT deleted, and Google access is not revoked');
  deps.print('  (remove that at https://myaccount.google.com/permissions).');

  if (!args.yes) {
    if (!deps.isTTY) throw new AdminInputError('not on a terminal: re-run with --yes to confirm the deletion');
    const typed = await deps.prompt(`Type the email (${user.email}) to confirm: `);
    if (norm(typed) !== user.email) throw new Error('the email did not match; nothing deleted');
  }
  await deps.deleteUser(user.id);
  deps.print(`deleted user ${user.email}`);
}
