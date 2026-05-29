export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: Buffer;
}

/** Decode a base64 ENCRYPTION_KEY and assert it is exactly 32 bytes. */
export function decodeEncryptionKey(raw: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

/** Load and validate Google/encryption config from an environment record. */
export function loadGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_REDIRECT_URI;
  const encryptionKeyRaw = env.ENCRYPTION_KEY;

  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');
  if (!clientSecret) throw new Error('GOOGLE_CLIENT_SECRET is not set');
  if (!redirectUri) throw new Error('GOOGLE_REDIRECT_URI is not set');
  if (!encryptionKeyRaw) throw new Error('ENCRYPTION_KEY is not set');

  return { clientId, clientSecret, redirectUri, encryptionKey: decodeEncryptionKey(encryptionKeyRaw) };
}
