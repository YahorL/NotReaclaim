import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { SettingsForm } from '../settings/SettingsForm';
import { AccountSection } from '../settings/AccountSection';
import { toFormState, defaultFormState, browserTimezone } from '../settings/settingsForm';
import { appVersion, formatAppVersion, type AppVersion } from '../lib/appVersion';

/** `version` is injectable so tests don't depend on build-time env injection. */
export function Settings({ version }: { version?: AppVersion } = {}) {
  const settingsQ = useSettingsQuery();
  const updateM = useUpdateSettingsMutation();

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
        <SettingsForm
          initial={initial}
          saving={updateM.isPending}
          justSaved={updateM.isSuccess}
          error={updateM.error instanceof ApiError ? updateM.error : null}
          onSave={(input) => updateM.mutate(input)}
        />
        <AccountSection />
        <p data-testid="app-version" className="mt-6 text-center text-xs text-inkSoft">
          {formatAppVersion(build)}
        </p>
      </div>
    </div>
  );
}
