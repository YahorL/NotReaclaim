import { describe, it, expect } from 'vitest';
import { parseAdminArgs, resolveInviter, ADMIN_USAGE } from '../src/admin-cli.js';

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

  it('create-user without a password is a google-only account', () => {
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
    expect(errorOf(['bogus'])).toMatch(/unknown command: bogus/);
  });

  it('missing required --email / --password', () => {
    expect(errorOf(['create-user'])).toMatch(/--email is required/);
    expect(errorOf(['set-password', '--email', 'a@b.co'])).toMatch(/--password is required/);
    expect(errorOf(['set-password', '--password', 'pw'])).toMatch(/--email is required/);
  });

  it('a value flag with no value, or followed by another flag', () => {
    expect(errorOf(['create-user', '--email'])).toMatch(/--email requires a value/);
    expect(errorOf(['create-user', '--email', '--admin'])).toMatch(/--email requires a value/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--password'])).toMatch(/--password requires a value/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--password', ''])).toMatch(/--password requires a value/);
  });

  it('an unknown or misplaced flag (a typo must not silently create a google-only user)', () => {
    expect(errorOf(['create-user', '--email', 'a@b.co', '--pasword', 'pw'])).toMatch(/unknown flag --pasword for create-user/);
    expect(errorOf(['set-password', '--email', 'a@b.co', '--password', 'pw', '--admin'])).toMatch(/unknown flag --admin/);
    expect(errorOf(['create-invite', '--password', 'pw'])).toMatch(/unknown flag --password/);
  });

  it('a stray positional argument or a repeated flag', () => {
    expect(errorOf(['create-user', 'a@b.co'])).toMatch(/unexpected argument: a@b.co/);
    expect(errorOf(['create-user', '--email', 'a@b.co', '--email', 'c@d.co'])).toMatch(/--email given more than once/);
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
