/**
 * Build identity, injected at `vite build` time from Docker build args
 * (GIT_SHA / BUILD_DATE → VITE_APP_VERSION / VITE_BUILD_DATE).
 */
export type AppVersion = { version: string; buildDate: string | null };

/** Only the fields we care about — `import.meta.env` has many more. */
export type VersionEnv = { VITE_APP_VERSION?: string; VITE_BUILD_DATE?: string };

/** `env` override exists so callers (and tests) don't have to fight import.meta. */
export function appVersion(env: VersionEnv = import.meta.env as VersionEnv): AppVersion {
  const version = env.VITE_APP_VERSION?.trim() || 'dev';
  const date = env.VITE_BUILD_DATE?.trim();
  return { version, buildDate: date && date !== 'unknown' ? date : null };
}

export function formatAppVersion(v: AppVersion): string {
  return v.buildDate ? `NotReclaim ${v.version} · built ${v.buildDate}` : `NotReclaim ${v.version}`;
}
