import { hash, verify } from '@node-rs/argon2';

/** Argon2id with library defaults (memory/time costs tuned for interactive logins). */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}
