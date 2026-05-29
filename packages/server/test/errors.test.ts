import { describe, it, expect } from 'vitest';
import { ZodError, z } from 'zod';
import { NotFoundError, ConflictError } from '@notreclaim/db';
import { SettingsRequiredError } from '@notreclaim/core';
import { GoogleNotConnectedError, GoogleApiError } from '@notreclaim/google';
import { mapDomainError } from '../src/errors.js';

describe('mapDomainError', () => {
  it('maps domain errors to HTTP statuses', () => {
    expect(mapDomainError(new NotFoundError('x')).status).toBe(404);
    expect(mapDomainError(new ConflictError('x')).status).toBe(409);
    expect(mapDomainError(new SettingsRequiredError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleNotConnectedError('u1')).status).toBe(409);
    expect(mapDomainError(new GoogleApiError(500, 'boom')).status).toBe(502);
    let zerr: unknown;
    try { z.object({ a: z.string() }).parse({}); } catch (e) { zerr = e; }
    expect(zerr).toBeInstanceOf(ZodError);
    expect(mapDomainError(zerr).status).toBe(400);
    expect(mapDomainError(new Error('other')).status).toBe(500);
  });
});
