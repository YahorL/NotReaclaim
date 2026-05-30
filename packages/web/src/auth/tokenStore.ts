const KEY = 'notreclaim.auth';

export interface StoredAuth {
  token: string;
  userId: string;
}

export const tokenStore = {
  get(): StoredAuth | null {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredAuth;
    } catch {
      return null;
    }
  },
  set(auth: StoredAuth): void {
    localStorage.setItem(KEY, JSON.stringify(auth));
  },
  clear(): void {
    localStorage.removeItem(KEY);
  },
};
