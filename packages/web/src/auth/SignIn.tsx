import { useApi } from '../api/ApiProvider';

export function SignIn() {
  const api = useApi();
  const onSignIn = async () => {
    const { url } = await api.getConsentUrl();
    window.location.assign(url);
  };
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">NotReclaim</h1>
      <p className="text-gray-500">Your calendar, auto-scheduled.</p>
      <button onClick={onSignIn} className="rounded bg-blue-600 px-4 py-2 text-white">
        Sign in with Google
      </button>
    </div>
  );
}
