export interface ServerConfig {
  port: number;
  jwtSecret: string;
  pollIntervalMs: number;
}

/** Read and validate server-specific env (Google/encryption come from loadGoogleConfig). */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${env.PORT}`);
  const pollIntervalMs = env.POLL_INTERVAL_MS ? Number(env.POLL_INTERVAL_MS) : 300000;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error(`Invalid POLL_INTERVAL_MS: ${env.POLL_INTERVAL_MS}`);
  }
  return { port, jwtSecret, pollIntervalMs };
}
