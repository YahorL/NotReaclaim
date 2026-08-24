import type { User, UserRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';
import { decryptToken, encryptToken } from './encryption.js';
import { GoogleGrantRevokedError, GoogleNotConnectedError } from './errors.js';

const TOKEN_SKEW_MS = 60_000;

export interface TokenServiceDeps {
  client: GoogleClient;
  users: Pick<UserRepository, 'findById' | 'findByGoogleId' | 'create' | 'update' | 'setGoogleAuthBroken'>;
  encryptionKey: Buffer;
  /**
   * Called only when the connection's health actually flips, so a caller can announce it
   * (the server turns this into a `google.status` WS event). Kept as a plain callback so
   * this package stays free of server types.
   */
  onAuthStatusChange?: (userId: string, broken: boolean) => void;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

export interface TokenService {
  connectFromCode(code: string, redirectUri: string): Promise<User>;
  exchangeCodeForLink(
    code: string,
    redirectUri: string,
  ): Promise<{ email: string; emailVerified: boolean; googleUserId: string; encryptedRefreshToken: string }>;
  getAccessToken(userId: string, now: number): Promise<string>;
}

export function createTokenService(deps: TokenServiceDeps): TokenService {
  const cache = new Map<string, CachedToken>();

  return {
    async connectFromCode(code, redirectUri): Promise<User> {
      const tokens = await deps.client.exchangeCode(code, redirectUri);
      const encrypted = encryptToken(tokens.refreshToken, deps.encryptionKey);
      const existing = await deps.users.findByGoogleId(tokens.googleUserId);
      if (existing) {
        return deps.users.update(existing.id, {
          email: tokens.email,
          googleRefreshToken: encrypted,
        });
      }
      const created = await deps.users.create({ email: tokens.email, googleId: tokens.googleUserId });
      return deps.users.update(created.id, { googleRefreshToken: encrypted });
    },

    async exchangeCodeForLink(code, redirectUri) {
      const tokens = await deps.client.exchangeCode(code, redirectUri);
      return {
        email: tokens.email,
        emailVerified: tokens.emailVerified,
        googleUserId: tokens.googleUserId,
        encryptedRefreshToken: encryptToken(tokens.refreshToken, deps.encryptionKey),
      };
    },

    async getAccessToken(userId, now): Promise<string> {
      const cached = cache.get(userId);
      if (cached && cached.expiresAt - TOKEN_SKEW_MS > now) {
        return cached.accessToken;
      }
      const user = await deps.users.findById(userId);
      if (!user || !user.googleRefreshToken) {
        throw new GoogleNotConnectedError(userId);
      }
      const refreshToken = decryptToken(user.googleRefreshToken, deps.encryptionKey);

      let refreshed: { accessToken: string; expiresAt: number };
      try {
        refreshed = await deps.client.refreshAccessToken(refreshToken);
      } catch (error) {
        // A dead grant is otherwise invisible to the user: record it (keeping the FIRST
        // failure's timestamp) so the API/UI can ask for a re-connect. ONLY a revoked grant
        // qualifies — a transient failure (outage, timeout, 429) must not raise that alert.
        if (error instanceof GoogleGrantRevokedError && (await deps.users.setGoogleAuthBroken(userId, new Date(now)))) {
          deps.onAuthStatusChange?.(userId, true);
        }
        throw error;
      }

      // Attempt the clear unconditionally: the `user` snapshot predates the network call, and
      // another refresh may have flagged the connection in the meantime. The conditional write
      // is the source of truth for whether this is a real transition worth announcing.
      if (await deps.users.setGoogleAuthBroken(userId, null)) {
        deps.onAuthStatusChange?.(userId, false);
      }
      cache.set(userId, refreshed);
      return refreshed.accessToken;
    },
  };
}
