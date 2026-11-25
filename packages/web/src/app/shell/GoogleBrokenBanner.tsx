import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { useGoogleStatusQuery } from '../../api/queries';
import { GOOGLE_LINK_FAILED, startGoogleLink } from '../lib/googleLink';
import { Icons } from './icons';

/**
 * App-wide alert for a dead Google grant: sync is silently down until the user re-consents,
 * so this sits above every page. A glass card with a danger headline (not the "couldn't fit"
 * warning) because it needs an action. Self-clearing — the `google.status` WS event refetches the status.
 */
export function GoogleBrokenBanner() {
  const api = useApi();
  const { data } = useGoogleStatusQuery();
  const [linkFailed, setLinkFailed] = useState(false);
  if (!data?.connected || data.brokenAt == null) return null;

  const reconnect = async () => {
    setLinkFailed(false);
    setLinkFailed(!(await startGoogleLink(api)));
  };

  return (
    <div
      data-testid="google-broken-banner"
      role="alert"
      className="glass-card mx-3 mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-card border-danger/30 px-4 py-2.5 text-[13px] md:mx-0 md:mt-0"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-danger">
        <Icons.warning size={15} /> Google Calendar sync is broken
      </span>
      <span className="text-fg-2">Reconnect your account to resume syncing.</span>
      <button
        type="button"
        onClick={() => { void reconnect(); }}
        className="btn-glass ml-auto rounded-pill px-3.5 py-1.5 text-[12.5px] font-semibold coarse:py-2.5"
      >
        Reconnect
      </button>
      {linkFailed && (
        <p data-testid="google-link-error" className="basis-full text-[12px] text-danger">{GOOGLE_LINK_FAILED}</p>
      )}
    </div>
  );
}
