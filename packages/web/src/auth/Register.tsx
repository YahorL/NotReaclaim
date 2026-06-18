import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';

export function Register() {
  const api = useApi();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const { token, userId } = await api.register({ email, password, inviteCode: inviteCode || undefined });
      setAuth({ token, userId });
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex w-72 flex-col gap-2">
        <label className="text-sm" htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-3 py-2" required />
        <label className="text-sm" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" minLength={10} required />
        <label className="text-sm" htmlFor="invite">Invite code (if required)</label>
        <input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} className="rounded border px-3 py-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Create account</button>
      </form>
      <p className="text-sm text-gray-500">Have an account? <Link to="/signin" className="text-blue-600">Sign in</Link></p>
    </div>
  );
}
