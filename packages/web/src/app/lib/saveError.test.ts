import { describe, it, expect } from 'vitest';
import { ApiError } from '../../api/client';
import { gatewayError, apiErrorFor } from '../../test/fakes';
import { saveErrorText, isServerUnreachable, SAVE_FAILED_NO_RESPONSE } from './saveError';

describe('saveErrorText', () => {
  it('a request that never got an answer (rejected fetch) → the connection line', () => {
    expect(saveErrorText(new TypeError('Failed to fetch'))).toBe(SAVE_FAILED_NO_RESPONSE);
  });

  it.each([502, 503, 504])('a proxy answering %i with its own page (API down or restarting) → the connection line', async (status) => {
    const error = await gatewayError(status);
    expect(error).toBeInstanceOf(ApiError);
    expect(saveErrorText(error)).toBe(SAVE_FAILED_NO_RESPONSE);
  });

  it("the API's own 502 (a Google failure, sent as its JSON error) keeps the server's message", async () => {
    const error = await apiErrorFor(502, { code: 'google_api_error', message: 'Google Calendar request failed' });
    expect(saveErrorText(error)).toBe('Google Calendar request failed');
  });

  it("a 500 is a real server error and keeps its message, even with a non-JSON body", async () => {
    expect(saveErrorText(await gatewayError(500))).toBe('Request failed with status 500');
    expect(saveErrorText(await apiErrorFor(500, { code: 'internal_error', message: 'Internal Server Error' }))).toBe('Internal Server Error');
  });

  it("a 400 shows the server's readable validation message verbatim", async () => {
    const error = await apiErrorFor(400, { code: 'validation_error', message: 'timezone: must be a valid IANA time zone' });
    expect(saveErrorText(error)).toBe('timezone: must be a valid IANA time zone');
  });
});

describe('isServerUnreachable', () => {
  it('true for a rejected fetch and a gateway page, false for anything the API itself answered', async () => {
    expect(isServerUnreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isServerUnreachable(await gatewayError(503))).toBe(true);
    expect(isServerUnreachable(await gatewayError(500))).toBe(false);
    expect(isServerUnreachable(await apiErrorFor(502, { code: 'google_api_error', message: 'x' }))).toBe(false);
    expect(isServerUnreachable(await apiErrorFor(409, { code: 'conflict', message: 'x' }))).toBe(false);
  });
});
