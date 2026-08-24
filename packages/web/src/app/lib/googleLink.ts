import type { ApiClient } from '../../api/client';

/**
 * Send the browser into Google's consent screen — used for both the first link and a re-link.
 * Returns false when the consent URL couldn't be fetched: callers must say so, since a silent
 * failure leaves an inert button under a banner that promises recovery.
 */
export async function startGoogleLink(api: Pick<ApiClient, 'getLinkGoogleUrl'>): Promise<boolean> {
  try {
    const { url } = await api.getLinkGoogleUrl();
    window.location.assign(url);
    return true;
  } catch {
    return false;
  }
}

export const GOOGLE_LINK_FAILED = 'Could not start the Google sign-in. Check your connection and try again.';
