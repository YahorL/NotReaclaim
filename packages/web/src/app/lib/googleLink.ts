import type { ApiClient } from '../../api/client';

/** Send the browser into Google's consent screen — used for both the first link and a re-link. */
export async function startGoogleLink(api: Pick<ApiClient, 'getLinkGoogleUrl'>): Promise<void> {
  const { url } = await api.getLinkGoogleUrl();
  window.location.assign(url);
}
