import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { useAuth } from './AuthContext';
import { ApiError } from '../api/client';
import { AuthCard, AuthField, AUTH_LINK } from './AuthCard';

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
    <AuthCard title="Create your account">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <AuthField id="email" label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <AuthField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" minLength={10} required />
        <AuthField id="invite" label="Invite code (if required)" value={inviteCode} onChange={setInviteCode} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="btn-accent mt-1 h-12 rounded-pill text-[15px] font-semibold">Create account</button>
      </form>
      <p className="text-center text-sm text-fg-2">Have an account? <Link to="/signin" className={AUTH_LINK}>Sign in</Link></p>
    </AuthCard>
  );
}
