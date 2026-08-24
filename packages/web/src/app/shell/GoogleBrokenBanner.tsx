import { useApi } from '../../api/ApiProvider';
import { useGoogleStatusQuery } from '../../api/queries';
import { startGoogleLink } from '../lib/googleLink';

/**
 * App-wide alert for a dead Google grant: sync is silently down until the user re-consents,
 * so this sits above every page. Red (not the amber "couldn't fit" warning) because it needs
 * an action. Self-clearing — the `google.status` WS event refetches the status.
 */
export function GoogleBrokenBanner() {
  const api = useApi();
  const { data } = useGoogleStatusQuery();
  if (!data?.connected || data.brokenAt == null) return null;

  return (
    <div
      data-testid="google-broken-banner"
      role="alert"
      className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-crit/30 bg-crit/10 px-3 py-1.5 text-[12.5px] text-crit"
    >
      <span className="font-bold">⚠ Google Calendar sync is broken</span>
      <span className="text-crit/80">Reconnect your account to resume syncing.</span>
      <button
        type="button"
        onClick={() => { void startGoogleLink(api); }}
        className="ml-auto rounded-[8px] bg-crit px-3 py-1 text-[12px] font-bold text-white hover:opacity-90"
      >
        Reconnect
      </button>
    </div>
  );
}
