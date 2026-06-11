import { ApiError } from '../../api/client';
import { useSettingsQuery, useUpdateSettingsMutation } from '../../api/queries';
import { SettingsForm } from '../settings/SettingsForm';
import { toFormState, defaultFormState } from '../settings/settingsForm';

export function Settings() {
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

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const initial = settingsQ.data ? toFormState(settingsQ.data) : defaultFormState(browserTz);

  return (
    <div className="p-4">
      <SettingsForm
        initial={initial}
        saving={updateM.isPending}
        justSaved={updateM.isSuccess}
        error={updateM.error instanceof ApiError ? updateM.error : null}
        onSave={(input) => updateM.mutate(input)}
      />
    </div>
  );
}
