import type { ServerEvent } from './events.js';

export interface Client {
  userId: string;
  send(data: string): void;
}

export interface ConnectionRegistry {
  add(client: Client): void;
  remove(client: Client): void;
  forward(event: ServerEvent): void;
  countForUser(userId: string): number;
}

export function createConnectionRegistry(): ConnectionRegistry {
  const byUser = new Map<string, Set<Client>>();

  function remove(client: Client): void {
    const set = byUser.get(client.userId);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) byUser.delete(client.userId);
  }

  return {
    add(client) {
      let set = byUser.get(client.userId);
      if (!set) {
        set = new Set();
        byUser.set(client.userId, set);
      }
      set.add(client);
    },
    remove,
    forward(event) {
      const set = byUser.get(event.userId);
      if (!set) return;
      const data = JSON.stringify(event);
      for (const client of [...set]) {
        try {
          client.send(data);
        } catch {
          remove(client);
        }
      }
    },
    countForUser(userId) {
      return byUser.get(userId)?.size ?? 0;
    },
  };
}
