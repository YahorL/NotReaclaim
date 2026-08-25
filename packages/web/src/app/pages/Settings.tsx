import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { SettingsForm } from '../settings/SettingsForm';
import { AccountSection } from '../settings/AccountSection';
import { toFormState, defaultFormState, browserTimezone } from '../settings/settingsForm';
import { appVersion, formatAppVersion, type AppVersion } from '../lib/appVersion';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from '../shell/icons';

/** `version` is injectable so tests don't depend on build-time env injection. */
export function Settings({ version }: { version?: AppVersion } = {}) {
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();
  const { signOut } = useAuth();

  if (settingsQ.isLoading) {
    return <div className="p-6 text-gray-500">Loading settings…</div>;
  }

  const notConfigured = settingsQ.error instanceof ApiError && settingsQ.error.status === 404;
  if (settingsQ.isError && !notConfigured) {
    return (
      <div className="p-6">
        <p className="mb-2 text-red-600">Couldn't load settings.</p>
        <button onClick={() => void settingsQ.refetch()} className="rounded border border-gray-300 px-3 py-1">Retry</button>
      </div>
    );
  }

  const initial = settingsQ.data ? toFormState(settingsQ.data) : defaultFormState(browserTimezone());
  const build = version ?? appVersion();

  return (
    <div className="p-4">
      <div className="mx-auto w-full max-w-[720px]">
        {/* Buffers and Hours have no mobile tab — they live here as link rows below md. */}
        <div data-testid="mobile-settings-links" className="mb-4 flex flex-col gap-2 md:hidden">
          <NavLink to="/buffers" className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 text-[15px] font-semibold text-ink">
            <span>Buffers</span>
            <Icons.chevDown size={18} className="-rotate-90 text-inkSoft" />
          </NavLink>
          <NavLink to="/hours" className="flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 text-[15px] font-semibold text-ink">
            <span>Hours</span>
            <Icons.chevDown size={18} className="-rotate-90 text-inkSoft" />
          </NavLink>
        </div>
        <SettingsForm
          initial={initial}
          saving={updateM.isPending}
          justSaved={updateM.isSuccess}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(input) => updateM.mutate(input)}
        />
        <AccountSection />
        {/* The avatar dropdown is dropped from the mobile bar, so sign-out lands here.
            The signed-in email is not available client-side (AuthContext holds only
            token + userId, and the server has no GET /auth/me). */}
        <div data-testid="mobile-account-row" className="mt-4 flex items-center justify-between rounded-[14px] border border-line bg-card px-4 py-3 md:hidden">
          <span className="text-[15px] font-semibold text-ink">Signed in</span>
          <button type="button" onClick={signOut} className="rounded-[9px] px-3 py-2 text-[14px] font-bold text-crit">
            Sign out
          </button>
        </div>
        <p data-testid="app-version" className="mt-6 text-center text-xs text-inkSoft">
          {formatAppVersion(build)}
        </p>
      </div>
    </div>
  );
}
