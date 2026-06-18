import type { User, UserRepository } from '@notreclaim/db';
import type { GoogleClient } from './client.js';
import { decryptToken, encryptToken } from './encryption.js';
import { GoogleNotConnectedError } from './errors.js';

const TOKEN_SKEW_MS = 60_000;

export interface TokenServiceDeps {
  client: GoogleClient;
  users: Pick<UserRepository, 'findById' | 'findByGoogleId' | 'create' | 'update'>;
  encryptionKey: Buffer;
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
      const { accessToken, expiresAt } = await deps.client.refreshAccessToken(refreshToken);
      cache.set(userId, { accessToken, expiresAt });
      return accessToken;
    },
  };
}
