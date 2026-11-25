import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';
import { AuthCard, AuthField, AUTH_LINK } from './AuthCard';

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
    <AuthCard title="NotReclaim" subtitle="Your calendar, auto-scheduled.">
      <form onSubmit={onPasswordSignIn} className="flex flex-col gap-3">
        <AuthField id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <AuthField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="btn-accent mt-1 h-12 rounded-pill text-[15px] font-semibold">Sign in</button>
      </form>
      <button type="button" onClick={onGoogle} className="btn-glass h-12 rounded-pill text-[15px] font-medium">Sign in with Google</button>
      <p className="text-center text-sm text-fg-2">No account? <Link to="/register" className={AUTH_LINK}>Create one</Link></p>
    </AuthCard>
  );
}
