import type { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { ConnectionRegistry, Client } from './connection-registry.js';

/** Verify the JWT carried in the WS handshake query (?token=...). Returns the userId or null; never throws. */
export function parseWsAuth(app: FastifyInstance, query: unknown): { userId: string } | null {
  const token = (query as { token?: unknown } | null | undefined)?.token;
  if (typeof token !== 'string' || token.length === 0) return null;
  try {
    const payload = app.jwt.verify<{ sub?: string }>(token);
    if (!payload.sub) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

/** Register @fastify/websocket and the authenticated /ws route. Connections that fail auth are closed immediately. */
export function registerWebSocket(app: FastifyInstance, registry: ConnectionRegistry): void {
  app.register(websocket);
  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (connection, request) => {
      const auth = parseWsAuth(instance, request.query);
      if (!auth) {
        connection.socket.close(1008, 'unauthorized');
        return;
      }
      const client: Client = {
        userId: auth.userId,
        send: (data) => connection.socket.send(data),
      };
      registry.add(client);
      connection.socket.on('close', () => registry.remove(client));
    });
  });
}
