import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function AuthCallback() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const err = params.get('error');
    if (err) { navigate(`/signin?error=${encodeURIComponent(err)}`, { replace: true }); return; }
    const token = params.get('token');
    const userId = params.get('userId');
    if (token && userId) {
      setAuth({ token, userId });
      navigate('/', { replace: true });
    } else {
      navigate('/signin', { replace: true });
    }
  }, [hash, navigate, setAuth]);

  return <p className="p-8 text-gray-500">Signing you in…</p>;
}
