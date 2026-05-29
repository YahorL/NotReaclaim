export interface ServerConfig {
  port: number;
  jwtSecret: string;
}

/** Read and validate server-specific env (Google/encryption come from loadGoogleConfig). */
export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is not set');
  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isFinite(port)) throw new Error(`Invalid PORT: ${env.PORT}`);
  return { port, jwtSecret };
}
