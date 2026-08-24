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
