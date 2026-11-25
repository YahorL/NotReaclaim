import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { saveErrorText } from '../lib/saveError';
import { useGoogleStatusQuery } from '../../api/queries';
import { GOOGLE_LINK_FAILED, startGoogleLink } from '../lib/googleLink';
import { CAPS_LABEL, INPUT } from '../forms/controls';

export function AccountSection() {
  const api = useApi();
  const statusQ = useGoogleStatusQuery();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null); setErr(null);
    try { await api.setPassword(password); setPassword(''); setMsg('Password saved'); }
    catch (e2) { setErr(saveErrorText(e2)); }
  };
  const linkGoogle = () => {
    void (async () => {
      setLinkFailed(false);
      setLinkFailed(!(await startGoogleLink(api)));
    })();
  };

  // Until the status is known (loading, or the request failed) fall back to the plain connect
  // affordance — never claim a connection we haven't confirmed.
  const status = statusQ.data;
  const connected = status?.connected === true;
  const broken = connected && status?.brokenAt != null;

  return (
    <section data-testid="account-section" aria-labelledby="account-caption" className="glass flex flex-col gap-4 rounded-panel px-[22px] py-5">
      <h2 id="account-caption" className={CAPS_LABEL}>Account</h2>
      <form onSubmit={savePassword} className="flex flex-col gap-2">
        <label className="text-[13px] text-fg-2" htmlFor="newpw">New password</label>
        <div className="flex flex-wrap gap-2.5">
          <input id="newpw" type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT} h-10 min-w-0 flex-1 px-3 text-[15px]`} required />
          <button type="submit" className="btn-glass h-10 shrink-0 rounded-pill px-4 text-[14px] font-medium">Save password</button>
        </div>
        {msg && <p role="status" className="text-[13px] text-fg-2">✓ {msg}</p>}
        {err && <p role="alert" className="text-[13px] text-danger">{err}</p>}
      </form>

      <div className="border-t border-line pt-4">
        {broken ? (
          <div data-testid="google-broken" className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-medium text-danger">⚠ Google Calendar connection broken — sync is stopped.</span>
            <button onClick={linkGoogle} className="btn-glass rounded-pill px-4 py-2 text-[13px] font-medium text-danger">
              Reconnect Google
            </button>
          </div>
        ) : connected ? (
          <div data-testid="google-connected" className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] text-fg-2">✓ Google Calendar connected</span>
            <button onClick={linkGoogle} className="rounded-pill px-2 py-1 text-[13px] font-medium text-accent-fg hover:underline">
              Re-link
            </button>
          </div>
        ) : (
          <button onClick={linkGoogle} className="btn-glass rounded-pill px-4 py-2 text-[14px] font-medium">Connect Google (calendar sync)</button>
        )}
        {linkFailed && (
          <p data-testid="google-link-error" className="mt-2 text-[12px] text-danger">{GOOGLE_LINK_FAILED}</p>
        )}
      </div>
    </section>
  );
}
