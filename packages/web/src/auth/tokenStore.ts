const KEY = 'notreclaim.auth';

export interface StoredAuth {
  token: string;
  userId: string;
}

// Storage can be blocked outright (privacy modes, disabled site data): then even *reading*
// `window.localStorage` throws. Every access is guarded, and the session is mirrored in memory
// so sign-in still works for the lifetime of the tab instead of white-screening the app.
let memory: string | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(): string | null {
  try {
    const s = storage();
    if (s) return s.getItem(KEY);
  } catch {
    /* fall through to memory */
  }
  return memory;
}

export const tokenStore = {
  get(): StoredAuth | null {
    const raw = readRaw();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      return null;
    }
  },
  set(auth: StoredAuth): void {
    memory = JSON.stringify(auth);
    try {
      storage()?.setItem(KEY, memory);
    } catch {
      /* memory only */
    }
  },
  clear(): void {
    memory = null;
    try {
      storage()?.removeItem(KEY);
    } catch {
      /* memory only */
    }
  },
};
