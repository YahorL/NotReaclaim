import { useState } from 'react';
import { useApi } from '../../api/ApiProvider';
import { ApiError } from '../../api/client';

export function AccountSection() {
  const api = useApi();
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null); setErr(null);
    try { await api.setPassword(password); setPassword(''); setMsg('Password saved'); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Failed'); }
  };
  const connectGoogle = async () => {
    const { url } = await api.getLinkGoogleUrl();
    window.location.assign(url);
  };

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
      <button onClick={connectGoogle} className="mt-4 rounded border px-4 py-2">Connect Google (calendar sync)</button>
    </section>
  );
}
