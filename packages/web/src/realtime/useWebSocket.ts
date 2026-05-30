import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateForEvent, type ServerEvent } from './events';

export interface SocketLike {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
  close(): void;
}

export interface UseWebSocketOptions {
  token: string | null;
  baseUrl?: string;
  makeSocket?: (url: string) => SocketLike;
}

const RECONNECT_MS = 2000;

function defaultUrl(baseUrl: string): string {
  if (baseUrl) return `${baseUrl.replace(/^http/, 'ws')}/ws`;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket({ token, baseUrl = '', makeSocket = (url) => new WebSocket(url) }: UseWebSocketOptions): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    let intentionallyClosed = false;
    let socket: SocketLike | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const url = `${defaultUrl(baseUrl)}?token=${encodeURIComponent(token)}`;
      try {
        socket = makeSocket(url);
      } catch {
        return; // environment without WebSocket (e.g. jsdom tests); skip realtime
      }
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
  }, [token, baseUrl, makeSocket, qc]);
}
