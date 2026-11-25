import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAllEventRoots, invalidateForEvent, type ServerEvent } from './events';
import { apiBaseUrl, webSocketUrl } from '../api/baseUrl';

export interface SocketLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  close(): void;
}

export interface UseWebSocketOptions {
  token: string | null;
  makeSocket?: (url: string) => SocketLike;
}

const RECONNECT_MS = 2000;

function defaultUrl(): string {
  return webSocketUrl(apiBaseUrl(), window.location);
}

const defaultMakeSocket = (url: string): SocketLike => new WebSocket(url);

export function useWebSocket({ token, makeSocket = defaultMakeSocket }: UseWebSocketOptions): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    let intentionallyClosed = false;
    let socket: SocketLike | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    // Scoped to this effect run, not a ref: StrictMode's dev remount and a token change both start
    // a fresh run, so the first open of the surviving socket / the new token is never a "reopen".
    let hasOpened = false;

    const connect = () => {
      const url = `${defaultUrl()}?token=${encodeURIComponent(token)}`;
      try {
        socket = makeSocket(url);
      } catch {
        return; // environment without WebSocket (e.g. jsdom tests); skip realtime
      }
      socket.addEventListener('open', () => {
        if (intentionallyClosed) return; // a discarded socket that opened anyway
        // Events sent while the connection was down are lost: catch up on a REopen only — the
        // first open follows the page's own initial fetches.
        if (hasOpened) invalidateAllEventRoots(qc);
        hasOpened = true;
      });
      socket.addEventListener('message', (ev) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data as string) as ServerEvent;
          invalidateForEvent(qc, event);
        } catch {
          // ignore non-JSON frames
        }
      });
      socket.addEventListener('close', () => {
        if (!intentionallyClosed) reconnectTimer = setTimeout(connect, RECONNECT_MS);
      });
    };

    connect();

    return () => {
      intentionallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [token, makeSocket, qc]);
}
