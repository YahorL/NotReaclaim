/**
 * Build identity, injected at `vite build` time from Docker build args
 * (GIT_SHA / BUILD_DATE → VITE_APP_VERSION / VITE_BUILD_DATE).
 */
export type AppVersion = { version: string; buildDate: string | null };

/** Only the fields we care about — `import.meta.env` has many more. */
export type VersionEnv = { VITE_APP_VERSION?: string; VITE_BUILD_DATE?: string };

function ambientEnv(): VersionEnv {
  // Guarded: test runners / non-Vite bundlers may not define import.meta.env.
  try {
    return ((import.meta as unknown as { env?: VersionEnv }).env ?? {}) as VersionEnv;
  } catch {
    return {};
  }
}

/** `env` override exists so callers (and tests) don't have to fight import.meta. */
export function appVersion(env?: VersionEnv): AppVersion {
  const e = env ?? ambientEnv();
  const version = e.VITE_APP_VERSION?.trim() || 'dev';
  const date = e.VITE_BUILD_DATE?.trim();
  return { version, buildDate: date && date !== 'unknown' ? date : null };
}

export function formatAppVersion(v: AppVersion): string {
  return v.buildDate ? `NotReclaim ${v.version} · built ${v.buildDate}` : `NotReclaim ${v.version}`;
}
