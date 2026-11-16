import type { User } from '@notreclaim/db';

/** A user counts as Google-connected while a refresh token is stored, even if the grant is broken. */
export function isGoogleConnected(user: Pick<User, 'googleRefreshToken'> | null | undefined): boolean {
  return user?.googleRefreshToken != null;
}
