import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { SettingsForm } from '../settings/SettingsForm';
import { AccountSection } from '../settings/AccountSection';
import { AppearanceSection } from '../settings/AppearanceSection';
import { toFormState, defaultFormState, browserTimezone } from '../settings/settingsForm';
import { appVersion, formatAppVersion, type AppVersion } from '../lib/appVersion';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from '../shell/icons';

const MOBILE_ROW = 'glass flex items-center justify-between rounded-card px-4 py-3 text-[15px] font-medium text-fg';

/** `version` is injectable so tests don't depend on build-time env injection. */
export function Settings({ version }: { version?: AppVersion } = {}) {
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();
  const { signOut } = useAuth();

  if (settingsQ.isLoading) {
    return <div className="px-4 pt-4 text-fg-2 md:px-1">Loading settings…</div>;
  }

  const notConfigured = settingsQ.error instanceof ApiError && settingsQ.error.status === 404;
  if (settingsQ.isError && !notConfigured) {
    return (
      <div className="px-4 pt-4 md:px-1">
        <p className="mb-3 text-danger">Couldn't load settings.</p>
        <button onClick={() => void settingsQ.refetch()} className="btn-glass rounded-pill px-4 py-2 text-[14px]">Retry</button>
      </div>
    );
  }

  const initial = settingsQ.data ? toFormState(settingsQ.data) : defaultFormState(browserTimezone());
  const build = version ?? appVersion();

  return (
    <div className="px-4 pb-6 pt-4 md:px-1 md:pt-0">
      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-5">
        {/* Buffers and Hours have no mobile tab — they live here as link rows below md. */}
        <div data-testid="mobile-settings-links" className="flex flex-col gap-2 md:hidden">
          <NavLink to="/buffers" className={MOBILE_ROW}>
            <span>Buffers</span>
            <Icons.chevRight size={18} className="text-fg-2" />
          </NavLink>
          <NavLink to="/hours" className={MOBILE_ROW}>
            <span>Hours</span>
            <Icons.chevRight size={18} className="text-fg-2" />
          </NavLink>
        </div>
        <SettingsForm
          initial={initial}
          saving={updateM.isPending}
          justSaved={updateM.isSuccess}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(input) => updateM.mutate(input)}
        />
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <AppearanceSection />
          <AccountSection />
        </div>
        {/* The avatar dropdown is dropped from the mobile bar, so sign-out lands here.
            The signed-in email is not available client-side (AuthContext holds only
            token + userId, and the server has no GET /auth/me). */}
        <div data-testid="mobile-account-row" className={`${MOBILE_ROW} md:hidden`}>
          <span>Signed in</span>
          <button type="button" onClick={signOut} className="rounded-pill px-3 py-2 text-[14px] font-semibold text-danger transition-colors hover:bg-danger/[.12] coarse:py-3">
            Sign out
          </button>
        </div>
        <p data-testid="app-version" className="text-center text-xs text-fg-2">
          {formatAppVersion(build)}
        </p>
      </div>
    </div>
  );
}
