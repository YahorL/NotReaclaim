import { describe, it, expect } from 'vitest';
import { ZodError, z } from 'zod';
import { NotFoundError, ConflictError } from '@notreclaim/db';
import { SettingsRequiredError } from '@notreclaim/core';
import { GoogleNotConnectedError, GoogleApiError, GoogleAuthError, GoogleGrantRevokedError } from '@notreclaim/google';
import { mapDomainError } from '../src/errors.js';

describe('mapDomainError', () => {
  it('maps domain errors to HTTP statuses', () => {
    expect(mapDomainError(new NotFoundError('x')).status).toBe(404);
    expect(mapDomainError(new ConflictError('x')).status).toBe(409);
    expect(mapDomainError(new SettingsRequiredError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleNotConnectedError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleApiError(500, 'boom')).status).toBe(502);
    expect(mapDomainError(new GoogleAuthError('invalid_grant'))).toMatchObject({
      status: 409,
      code: 'google_auth_broken',
    });
    let zerr: unknown;
    try { z.object({ a: z.string() }).parse({}); } catch (e) { zerr = e; }
    expect(zerr).toBeInstanceOf(ZodError);
    expect(mapDomainError(zerr).status).toBe(400);
    expect(mapDomainError(new Error('other')).status).toBe(500);
  });

  it('turns a validation failure into one readable sentence per problem, not zod\'s JSON dump', () => {
    const schema = z.object({
      email: z.string().email(),
      hours: z.array(z.object({ end: z.number().min(0) })),
    }).refine(() => false, { message: 'the whole body is wrong' });
    const result = schema.safeParse({ email: 'nope', hours: [{ end: 1 }, { end: -1 }] });
    expect(result.success).toBe(false);
    const mapped = mapDomainError((result as { error: ZodError }).error);
    expect(mapped).toEqual({
      status: 400,
      code: 'validation_error',
      message: 'email: Invalid email; hours.1.end: Number must be greater than or equal to 0; the whole body is wrong',
    });
  });

  it('prints a body-level (path-less) issue as the bare message', () => {
    const result = z.object({}).refine(() => false, { message: 'empty update' }).safeParse({});
    expect(mapDomainError((result as { error: ZodError }).error).message).toBe('empty update');
  });

  it('replaces Google\'s raw auth message with an actionable one', () => {
    // The raw text ("invalid_grant", a gaxios stack line) is for the logs, not for a user
    // staring at a failed replan.
    for (const error of [new GoogleAuthError('invalid_grant'), new GoogleGrantRevokedError('invalid_grant')]) {
      expect(mapDomainError(error)).toEqual({
        status: 409,
        code: 'google_auth_broken',
        message: 'Google connection needs reconnecting',
      });
    }
  });
});
