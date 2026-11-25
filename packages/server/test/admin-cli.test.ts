import { describe, it, expect, vi } from 'vitest';
import {
  parseAdminArgs, resolveInviter, ADMIN_USAGE, resolvePassword, AdminInputError, ARGV_PASSWORD_WARNING, STDIN_PASSWORD_NOTICE,
  defaultAdminTimezone, pickFirstAdmin, runDeleteUser, MIN_PASSWORD_LENGTH, type PasswordIO, type DeleteUserDeps,
} from '../src/admin-cli.js';
import { registerSchema, setPasswordSchema } from '../src/schemas.js';

const errorOf = (argv: string[]): string => {
  const parsed = parseAdminArgs(argv);
  if (parsed.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(parsed)}`);
  return parsed.message;
};

describe('parseAdminArgs — valid invocations keep working', () => {
  it('create-user with a password and --admin (the documented bootstrap)', () => {
    expect(parseAdminArgs(['create-user', '--email', ' You@Example.com ', '--password', 'pw', '--admin'])).toEqual({
      kind: 'create-user', email: 'you@example.com', password: 'pw', admin: true,
    });
  });

  // Was "create-user without a password is a google-only account": omitting --password now
  // means "ask for it" (prompt or stdin); a google-only account needs an explicit --google-only.
  it('create-user without --password leaves the password to be asked for', () => {
    expect(parseAdminArgs(['create-user', '--email', 'a@b.co'])).toEqual({
      kind: 'create-user', email: 'a@b.co', password: undefined, admin: false,
    });
  });

  it('flag order does not matter', () => {
    expect(parseAdminArgs(['create-user', '--admin', '--password', 'pw', '--email', 'a@b.co'])).toEqual({
      kind: 'create-user', email: 'a@b.co', password: 'pw', admin: true,
    });
  });

  it('set-password', () => {
    expect(parseAdminArgs(['set-password', '--email', 'A@b.co', '--password', 'new-pw'])).toEqual({
      kind: 'set-password', email: 'a@b.co', password: 'new-pw',
    });
  });

  it('create-invite with no flags: unbound, single use, no expiry', () => {
    expect(parseAdminArgs(['create-invite'])).toEqual({
      kind: 'create-invite', email: null, by: undefined, maxUses: 1, expiresAt: null,
    });
  });

  it('create-invite with every flag', () => {
    expect(parseAdminArgs([
      'create-invite', '--email', 'Friend@x.io', '--by', 'Owner@x.io', '--max-uses', '3', '--expires', '2027-01-01T00:00:00Z',
    ])).toEqual({
      kind: 'create-invite', email: 'friend@x.io', by: 'owner@x.io', maxUses: 3, expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
  });

  it('help is not an error', () => {
    for (const h of ['help', '--help', '-h']) expect(parseAdminArgs([h])).toEqual({ kind: 'help' });
    expect(ADMIN_USAGE).toContain('--by');
  });
});

describe('parseAdminArgs — bad arguments become usage errors, never crashes', () => {
  it('missing or unknown command', () => {
    expect(errorOf([])).toMatch(/missing command/);
    expect(errorOf(['bogus'])).toBe('unknown command (argument 1; not shown)');
  });

  // The set-password "--password is required" assertion pinned the defect (a password only on
  // argv); without it the password is now prompted for / read from stdin.
  it('missing required --email', () => {
    expect(errorOf(['create-user'])).toMatch(/--email is required/);
    expect(errorOf(['set-password', '--password', 'pw'])).toMatch(/--email is required/);
    expect(errorOf(['delete-user'])).toMatch(/--email is required/);
  });

  it('a value flag with no value, or followed by another flag', () => {
    expect(errorOf(['create-user', '--email'])).toMatch(/--email requires a value/);
    expect(errorOf(['create-user', '--email', '--admin'])).toMatch(/--email requires a value/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--password'])).toMatch(/--password requires a value/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--password', ''])).toMatch(/--password requires a value/);
  });

  it('an unknown or misplaced flag (a typo must not silently create a google-only user)', () => {
    expect(errorOf(['create-user', '--email', 'a@b.co', '--pasword', 'pw'])).toBe('unknown flag (argument 3; not shown)');
    expect(errorOf(['set-password', '--email', 'a@b.co', '--password', 'pw', '--admin'])).toMatch(/unknown flag --admin/);
    expect(errorOf(['create-invite', '--password', 'pw'])).toMatch(/unknown flag --password/);
  });

  it('a stray positional argument or a repeated flag', () => {
    expect(errorOf(['create-user', 'a@b.co'])).toMatch(/unexpected argument 1/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--email', 'c@d.co'])).toMatch(/--email given more than once/);
  });

  describe('--flag=value, and never echoing a value', () => {
    it('accepts --flag=value like --flag value (split at the first =)', () => {
      expect(parseAdminArgs(['create-user', '--email=A@b.co', '--password=pass=word=12', '--admin'])).toEqual({
        kind: 'create-user', email: 'a@b.co', password: 'pass=word=12', admin: true,
      });
      expect(parseAdminArgs(['create-invite', '--max-uses=3'])).toMatchObject({ kind: 'create-invite', maxUses: 3 });
    });

    it('an error about a --flag=value token names the flag, never the value', () => {
      const cases: Array<[string[], RegExp]> = [
        [['create-user', '--email', 'a@b.co', '--pasword=s3cret-value'], /^unknown flag \(argument 3; not shown\)$/],
        [['delete-user', '--email', 'a@b.co', '--password=s3cret-value'], /unknown flag --password for delete-user/],
        [['create-user', '--email', 'a@b.co', '--admin=s3cret-value'], /--admin takes no value/],
        [['create-user', '--email', 'a@b.co', '--password=s3cret-value', '--password=s3cret-value'], /--password given more than once/],
        [['--password=s3cret-value', 'set-password', '--email', 'a@b.co'], /the command must come first/],
        [['-p=s3cret-value', 'set-password'], /the command must come first/],
      ];
      for (const [argv, message] of cases) {
        const error = errorOf(argv);
        expect(error).toMatch(message);
        expect(error).not.toContain('s3cret-value');
      }
      expect(errorOf(['create-user', '--email', 'a@b.co', '--password='])).toMatch(/--password requires a value/);
    });

    it('a stray argument (e.g. the rest of an unquoted password) is not echoed', () => {
      const error = errorOf(['set-password', '--email', 'a@b.co', '--password', 'correct', 'horse-battery']);
      expect(error).toMatch(/unexpected argument 5/);
      expect(error).not.toContain('horse-battery');
    });
  });

  describe('an argument that is not a known command or flag name is never printed', () => {
    it('a flag and its value passed as one argv token (quoted "--password secret")', () => {
      const error = errorOf(['set-password', '--email', 'a@b.co', '--password secret12345']);
      expect(error).toBe('unknown flag (argument 3; not shown)');
      expect(error).not.toContain('secret12345');
    });

    it('the rest of an unquoted password that starts with --', () => {
      const error = errorOf(['set-password', '--email', 'a@b.co', '--password', 'abc', '--def12345']);
      expect(error).toBe('unknown flag (argument 5; not shown)');
      expect(error).not.toContain('def12345');
    });

    it('a first argument that is not a command (e.g. a password typed in the wrong place)', () => {
      const error = errorOf(['hunter2hunter2', '--email', 'a@b.co']);
      expect(error).toBe('unknown command (argument 1; not shown)');
      expect(error).not.toContain('hunter2');
    });

    it('a known flag on the wrong command is still named', () => {
      expect(errorOf(['set-password', '--email', 'a@b.co', '--admin'])).toBe('unknown flag --admin for set-password');
      expect(errorOf(['delete-user', '--max-uses=3'])).toBe('unknown flag --max-uses for delete-user');
    });

    it('a mistyped flag gets the position-only message', () => {
      expect(errorOf(['create-invite', '--max-use', '3'])).toBe('unknown flag (argument 1; not shown)');
      expect(errorOf(['delete-user', '--email', 'a@b.co', '--yess'])).toBe('unknown flag (argument 3; not shown)');
    });
  });

  it('a malformed email', () => {
    expect(errorOf(['create-user', '--email', 'not-an-email'])).toMatch(/--email must be an email address/);
    expect(errorOf(['create-invite', '--by', 'nobody'])).toMatch(/--by must be an email address/);
  });

  it('--max-uses must be a positive integer', () => {
    for (const bad of ['0', '-1', '1.5', 'abc']) {
      expect(errorOf(['create-invite', '--max-uses', bad])).toMatch(/--max-uses must be a positive integer/);
    }
  });

  it('--expires must be a date', () => {
    expect(errorOf(['create-invite', '--expires', 'next-tuesday'])).toMatch(/--expires must be a date/);
  });
});

describe('resolveInviter', () => {
  type U = { id: string; email: string };
  const users: U[] = [
    { id: 'admin', email: 'owner@x.io' },
    { id: 'friend', email: 'friend@x.io' }, // the invitee already has an account
  ];
  const lookup = {
    findByEmail: async (e: string) => users.find((u) => u.email === e) ?? null,
    firstAdmin: async () => users[0]!,
  };

  it('never takes the invitee (--email) as the issuer', async () => {
    expect((await resolveInviter({ email: 'friend@x.io', by: undefined }, lookup)).id).toBe('admin');
  });

  it('uses --by when given', async () => {
    expect((await resolveInviter({ email: 'friend@x.io', by: 'friend@x.io' }, lookup)).id).toBe('friend');
  });

  it('falls back to the first admin with no --by', async () => {
    expect((await resolveInviter({ email: null, by: undefined }, lookup)).id).toBe('admin');
  });

  it('an unknown --by is an error, not a silent fallback to someone else', async () => {
    await expect(resolveInviter({ email: null, by: 'ghost@x.io' }, lookup)).rejects.toThrow(/no user with --by email ghost@x.io/);
  });
});

describe('parseAdminArgs — new flags and commands', () => {
  it('set-password without --password leaves the password to be asked for', () => {
    expect(parseAdminArgs(['set-password', '--email', 'a@b.co'])).toEqual({ kind: 'set-password', email: 'a@b.co', password: undefined });
  });

  it('create-user --google-only creates a password-less account, and cannot be combined with --password', () => {
    expect(parseAdminArgs(['create-user', '--email', 'a@b.co', '--google-only'])).toEqual({
      kind: 'create-user', email: 'a@b.co', password: undefined, admin: false, googleOnly: true,
    });
    expect(errorOf(['create-user', '--email', 'a@b.co', '--google-only', '--password', 'longenough'])).toMatch(/--google-only and --password/);
  });

  it('create-user --timezone takes a valid IANA zone and rejects anything else', () => {
    expect(parseAdminArgs(['create-user', '--email', 'a@b.co', '--timezone', 'Europe/Berlin'])).toEqual({
      kind: 'create-user', email: 'a@b.co', password: undefined, admin: false, timezone: 'Europe/Berlin',
    });
    for (const bad of ['Mars/Olympus', 'local', '+03:00']) {
      expect(errorOf(['create-user', '--email', 'a@b.co', '--timezone', bad])).toMatch(/--timezone must be an IANA time zone/);
    }
  });

  it('delete-user, with and without --yes', () => {
    expect(parseAdminArgs(['delete-user', '--email', 'A@b.co'])).toEqual({ kind: 'delete-user', email: 'a@b.co', yes: false });
    expect(parseAdminArgs(['delete-user', '--yes', '--email', 'a@b.co'])).toEqual({ kind: 'delete-user', email: 'a@b.co', yes: true });
    expect(errorOf(['delete-user', '--email', 'a@b.co', '--password', 'x'])).toMatch(/unknown flag --password for delete-user/);
  });

  it('usage documents the new commands and flags', () => {
    for (const text of ['delete-user', '--yes', '--timezone', '--google-only', 'stdin']) expect(ADMIN_USAGE).toContain(text);
  });
});

describe('resolvePassword', () => {
  const io = (over: Partial<PasswordIO> = {}): PasswordIO & { warnings: string[] } => {
    const warnings: string[] = [];
    return {
      isTTY: false,
      promptHidden: async () => { throw new Error('unexpected prompt'); },
      readStdin: async () => { throw new Error('unexpected stdin read'); },
      warn: (m) => { warnings.push(m); },
      warnings,
      ...over,
    };
  };

  it('on a terminal, asks twice without echo and returns the password', async () => {
    const promptHidden = vi.fn().mockResolvedValueOnce('correct horse').mockResolvedValueOnce('correct horse');
    const i = io({ isTTY: true, promptHidden });
    expect(await resolvePassword(undefined, i)).toBe('correct horse');
    expect(promptHidden).toHaveBeenCalledTimes(2);
    expect(i.warnings).toEqual([]);
  });

  it('on a terminal, refuses two different entries', async () => {
    const promptHidden = vi.fn().mockResolvedValueOnce('correct horse').mockResolvedValueOnce('correct hors');
    await expect(resolvePassword(undefined, io({ isTTY: true, promptHidden }))).rejects.toThrow(/do not match/);
  });

  it('when piped, reads the first line of stdin, stripping only the line ending', async () => {
    expect(await resolvePassword(undefined, io({ readStdin: async () => '  spaced pass  \r\nignored\n' }))).toBe('  spaced pass  ');
    expect(await resolvePassword(undefined, io({ readStdin: async () => 'no-newline-pw' }))).toBe('no-newline-pw');
  });

  it('strips a trailing CR as well as CRLF / LF, and nothing else', async () => {
    for (const [input, expected] of [
      ['windows-pw-1\r', 'windows-pw-1'],
      ['windows-pw-1\r\n', 'windows-pw-1'],
      ['unix-pass-1\n', 'unix-pass-1'],
      ['in\rside-pw-1\n', 'in\rside-pw-1'],
      [' padded-pw-1 \r\n', ' padded-pw-1 '],
    ] as const) {
      expect(await resolvePassword(undefined, io({ readStdin: async () => input }))).toBe(expected);
    }
    await expect(resolvePassword(undefined, io({ readStdin: async () => '\r\n' }))).rejects.toBeInstanceOf(AdminInputError);
  });

  it('says on stderr that it is reading stdin before it blocks on it (not on a terminal or for argv)', async () => {
    const order: string[] = [];
    const piped = io({ readStdin: async () => { order.push('read'); return 'piped-password\n'; } });
    const warn = piped.warn;
    piped.warn = (m) => { order.push(`warn:${m}`); warn(m); };
    await resolvePassword(undefined, piped);
    expect(order).toEqual([`warn:${STDIN_PASSWORD_NOTICE}`, 'read']);
    expect(STDIN_PASSWORD_NOTICE).toMatch(/reading the password from standard input/i);

    const tty = io({ isTTY: true, promptHidden: vi.fn().mockResolvedValue('typed-password') });
    await resolvePassword(undefined, tty);
    expect(tty.warnings).toEqual([]);
  });

  it('a password starting with -- works when prompted or piped', async () => {
    expect(await resolvePassword(undefined, io({ readStdin: async () => '--dashes-first\n' }))).toBe('--dashes-first');
    const promptHidden = vi.fn().mockResolvedValue('--dashes-first');
    expect(await resolvePassword(undefined, io({ isTTY: true, promptHidden }))).toBe('--dashes-first');
  });

  it('empty stdin is an error, never a password-less account', async () => {
    for (const input of ['', '\n']) {
      await expect(resolvePassword(undefined, io({ readStdin: async () => input }))).rejects.toBeInstanceOf(AdminInputError);
    }
  });

  it('requires at least 10 characters from every source, like registering in the app', async () => {
    await expect(resolvePassword('nine-char', io())).rejects.toThrow(/at least 10 characters/);
    await expect(resolvePassword(undefined, io({ readStdin: async () => 'nine-char\n' }))).rejects.toThrow(/at least 10 characters/);
    const promptHidden = vi.fn().mockResolvedValue('nine-char');
    await expect(resolvePassword(undefined, io({ isTTY: true, promptHidden }))).rejects.toThrow(/at least 10 characters/);
    expect(await resolvePassword(undefined, io({ readStdin: async () => '10chars!!!' }))).toBe('10chars!!!');
  });

  it('uses the same minimum as the server\'s register / set-password schemas', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    for (const schema of [registerSchema, setPasswordSchema]) {
      const body = (password: string) => ({ email: 'a@b.co', password });
      expect(schema.safeParse(body('x'.repeat(MIN_PASSWORD_LENGTH - 1))).success).toBe(false);
      expect(schema.safeParse(body('x'.repeat(MIN_PASSWORD_LENGTH))).success).toBe(true);
    }
    expect(ADMIN_USAGE).toContain(`at least ${MIN_PASSWORD_LENGTH} characters`);
  });

  it('still accepts --password on argv, with a warning that it is visible', async () => {
    const i = io();
    expect(await resolvePassword('from-argv-pw', i)).toBe('from-argv-pw');
    expect(i.warnings).toEqual([ARGV_PASSWORD_WARNING]);
    expect(ARGV_PASSWORD_WARNING).toMatch(/shell history/);
    expect(ARGV_PASSWORD_WARNING).toMatch(/process list/);
  });
});

describe('defaultAdminTimezone', () => {
  it('uses the server process zone when valid, else UTC', () => {
    expect(defaultAdminTimezone('Europe/Berlin')).toBe('Europe/Berlin');
    for (const bad of [undefined, '', 'Mars/Olympus']) expect(defaultAdminTimezone(bad)).toBe('UTC');
  });
});

describe('pickFirstAdmin', () => {
  const admin = (id: string, createdAt: string, isAdmin = true) => ({ id, isAdmin, createdAt: new Date(createdAt) });

  it('is the oldest admin, then the smallest id — whatever order the rows come in', () => {
    const rows = [
      admin('c', '2026-03-01T00:00:00Z'),
      admin('b', '2026-01-01T00:00:00Z'),
      admin('z', '2025-01-01T00:00:00Z', false),
      admin('a', '2026-01-01T00:00:00Z'),
    ];
    expect(pickFirstAdmin(rows)!.id).toBe('a');
    expect(pickFirstAdmin([...rows].reverse())!.id).toBe('a');
  });

  it('null when there is no admin', () => {
    expect(pickFirstAdmin([admin('z', '2025-01-01T00:00:00Z', false)])).toBeNull();
  });
});

describe('runDeleteUser', () => {
  const user = { id: 'u2', email: 'friend@x.io', isAdmin: false };
  const deps = (over: Partial<DeleteUserDeps> = {}): DeleteUserDeps & { deleted: string[]; out: string[] } => {
    const deleted: string[] = [];
    const out: string[] = [];
    return {
      findByEmail: async (e) => (e === user.email ? user : null),
      countAdmins: async () => 1,
      countOwned: async () => ({ tasks: 3, habits: 2, blocks: 7, events: 4, invites: 1 }),
      deleteUser: async (id) => { deleted.push(id); },
      isTTY: false,
      prompt: async () => { throw new Error('unexpected prompt'); },
      print: (line) => { out.push(line); },
      deleted,
      out,
      ...over,
    };
  };

  it('shows what will go, including that Google is not touched, then deletes with --yes', async () => {
    const d = deps();
    await runDeleteUser({ email: 'friend@x.io', yes: true }, d);
    expect(d.deleted).toEqual(['u2']);
    const text = d.out.join('\n');
    expect(text).toContain('friend@x.io');
    expect(text).toMatch(/3 tasks/);
    expect(text).toMatch(/2 habits/);
    expect(text).toMatch(/7 scheduled blocks/);
    expect(text).toMatch(/4 calendar events/);
    expect(text).toMatch(/1 invite code/);
    expect(text).toMatch(/Google Calendar events.*not deleted/i);
    expect(text).toMatch(/Google access is not revoked/i);
    expect(text).toMatch(/signed-in sessions are not ended.*fail until (its|their) token expires/i);
    expect(text).toMatch(/deleted user friend@x.io/);
  });

  it('on a terminal, deletes only when the email is typed again (normalised like --email)', async () => {
    const ok = deps({ isTTY: true, prompt: async () => '  Friend@X.io ' });
    await runDeleteUser({ email: 'friend@x.io', yes: false }, ok);
    expect(ok.deleted).toEqual(['u2']);

    const wrong = deps({ isTTY: true, prompt: async () => 'someone@else.io' });
    await expect(runDeleteUser({ email: 'friend@x.io', yes: false }, wrong)).rejects.toThrow(/did not match.*nothing deleted/);
    expect(wrong.deleted).toEqual([]);
  });

  it('off a terminal without --yes, refuses as a usage error and deletes nothing', async () => {
    const d = deps();
    await expect(runDeleteUser({ email: 'friend@x.io', yes: false }, d)).rejects.toBeInstanceOf(AdminInputError);
    expect(d.deleted).toEqual([]);
  });

  it('refuses to delete the last admin, before asking anything', async () => {
    const prompt = vi.fn();
    const d = deps({ findByEmail: async () => ({ ...user, isAdmin: true }), countAdmins: async () => 1, isTTY: true, prompt });
    await expect(runDeleteUser({ email: 'friend@x.io', yes: true }, d)).rejects.toThrow(/last admin/);
    expect(prompt).not.toHaveBeenCalled();
    expect(d.deleted).toEqual([]);
  });

  it('may delete an admin while another admin remains', async () => {
    const d = deps({ findByEmail: async () => ({ ...user, isAdmin: true }), countAdmins: async () => 2 });
    await runDeleteUser({ email: 'friend@x.io', yes: true }, d);
    expect(d.deleted).toEqual(['u2']);
  });

  it('an unknown email is an error', async () => {
    const d = deps();
    await expect(runDeleteUser({ email: 'ghost@x.io', yes: true }, d)).rejects.toThrow(/no such user/);
    expect(d.deleted).toEqual([]);
  });
});
