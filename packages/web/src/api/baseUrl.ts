/** The API base both the HTTP client and the realtime socket build on: `VITE_API_URL`, or '' for same-origin.
 *  Trailing slashes are dropped because callers append paths that start with '/'. Read on every call (not at
 *  module load) so the value is the one Vite inlined at build time, and tests can stub it. */
export function apiBaseUrl(raw: string | undefined = import.meta.env.VITE_API_URL): string {
  return (raw ?? '').replace(/\/+$/, '');
}

/** The `/ws` URL for an API base (as returned by `apiBaseUrl`). An empty base means the page's own host,
 *  exactly as before VITE_API_URL was honoured; otherwise the base resolves against the page the way
 *  fetch() resolves the HTTP client's URLs, with http→ws and https→wss. */
export function webSocketUrl(base: string, page: { protocol: string; host: string; href: string }): string {
  if (!base) {
    const proto = page.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${page.host}/ws`;
  }
  const url = new URL(`${base}/ws`, page.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
