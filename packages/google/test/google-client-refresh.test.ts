import { describe, it, expect, vi, beforeEach } from 'vitest';

// OAuth token refresh goes through google-auth-library's own transporter (not global fetch),
// so the library is stubbed here to script exactly what a failed refresh rejects with.
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    setCredentials(): void {}
    refreshAccessToken(): Promise<{ credentials: { access_token?: string; expiry_date?: number } }> {
      return refreshMock();
    }
  },
}));

import { createGoogleClient } from '../src/google-client.js';
import { GoogleAuthError, GoogleGrantRevokedError } from '../src/errors.js';

const client = createGoogleClient({ clientId: 'cid', clientSecret: 'secret' });

/** Shaped like the GaxiosError google-auth-library rejects with on a token endpoint refusal. */
function gaxiosError(status: number, data: unknown, message = 'invalid_grant') {
  return Object.assign(new Error(message), {
    status,
    response: { status, data },
  });
}

beforeEach(() => {
  refreshMock.mockReset();
});

describe('googleClient.refreshAccessToken', () => {
  it('returns the refreshed credentials on success', async () => {
    refreshMock.mockResolvedValue({ credentials: { access_token: 'at-9', expiry_date: 1234 } });
    expect(await client.refreshAccessToken('rt')).toEqual({ accessToken: 'at-9', expiresAt: 1234 });
  });

  it('maps a 400 invalid_grant refusal to GoogleGrantRevokedError', async () => {
    refreshMock.mockRejectedValue(gaxiosError(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }));
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('maps a 401 invalid_grant refusal to GoogleGrantRevokedError', async () => {
    refreshMock.mockRejectedValue(gaxiosError(401, { error: 'invalid_grant' }));
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('reads invalid_grant out of an unparsed string body', async () => {
    refreshMock.mockRejectedValue(gaxiosError(400, '{"error":"invalid_grant"}'));
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('keeps a transient network failure a plain GoogleAuthError', async () => {
    refreshMock.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com'), { code: 'ENOTFOUND' }),
    );
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleAuthError);
    await expect(client.refreshAccessToken('rt')).rejects.not.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('keeps a Google 5xx outage a plain GoogleAuthError', async () => {
    refreshMock.mockRejectedValue(gaxiosError(503, { error: 'backendError' }, 'Backend Error'));
    await expect(client.refreshAccessToken('rt')).rejects.not.toBeInstanceOf(GoogleGrantRevokedError);
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('keeps a 400 that is not invalid_grant a plain GoogleAuthError', async () => {
    refreshMock.mockRejectedValue(gaxiosError(400, { error: 'invalid_client' }, 'invalid_client'));
    await expect(client.refreshAccessToken('rt')).rejects.not.toBeInstanceOf(GoogleGrantRevokedError);
  });

  it('survives a rejection with no response at all', async () => {
    refreshMock.mockRejectedValue('boom');
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('rejects a refresh that returns no access token', async () => {
    refreshMock.mockResolvedValue({ credentials: {} });
    await expect(client.refreshAccessToken('rt')).rejects.toBeInstanceOf(GoogleAuthError);
  });
});
