import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';

export function SignIn() {
  const api = useApi();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onPasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { token, userId } = await api.login({ email, password });
      setAuth({ token, userId });
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = async () => {
    const { url } = await api.getConsentUrl();
    window.location.assign(url);
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">NotReclaim</h1>
      <p className="text-gray-500">Your calendar, auto-scheduled.</p>
      <form onSubmit={onPasswordSignIn} className="flex w-72 flex-col gap-2">
        <label className="text-sm" htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-3 py-2" required />
        <label className="text-sm" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Sign in</button>
      </form>
      <button onClick={onGoogle} className="rounded border px-4 py-2">Sign in with Google</button>
      <p className="text-sm text-gray-500">No account? <Link to="/register" className="text-blue-600">Create one</Link></p>
    </div>
  );
}
