import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { ApiError } from '../../api/client';
import { useGoogleStatusQuery } from '../../api/queries';
import { GOOGLE_LINK_FAILED, startGoogleLink } from '../lib/googleLink';

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
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Failed'); }
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
    <section className="mt-8 rounded-[14px] border border-line p-4">
      <h2 className="mb-3 text-lg font-semibold">Account</h2>
      <form onSubmit={savePassword} className="flex max-w-sm flex-col gap-2">
        <label className="text-sm" htmlFor="newpw">New password</label>
        <input id="newpw" type="password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" required />
        {msg && <p className="text-sm text-green-600">{msg}</p>}
        {err && <p className="text-sm text-red-600">{err}</p>}
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white">Save password</button>
      </form>

      {broken ? (
        <div data-testid="google-broken" className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-semibold text-crit">⚠ Google Calendar connection broken — sync is stopped.</span>
          <button onClick={linkGoogle} className="rounded-[9px] bg-crit px-4 py-2 text-[13px] font-bold text-white hover:opacity-90">
            Reconnect Google
          </button>
        </div>
      ) : connected ? (
        <div data-testid="google-connected" className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-inkSoft">✓ Google Calendar connected</span>
          <button onClick={linkGoogle} className="text-[13px] font-semibold text-indigo hover:underline">
            Re-link
          </button>
        </div>
      ) : (
        <button onClick={linkGoogle} className="mt-4 rounded border px-4 py-2">Connect Google (calendar sync)</button>
      )}
      {linkFailed && (
        <p data-testid="google-link-error" className="mt-2 text-[12px] text-crit">{GOOGLE_LINK_FAILED}</p>
      )}
    </section>
  );
}
