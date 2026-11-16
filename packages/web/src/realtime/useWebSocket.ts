import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateForEvent, type ServerEvent } from './events';

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
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const defaultMakeSocket = (url: string): SocketLike => new WebSocket(url);

export function useWebSocket({ token, makeSocket = defaultMakeSocket }: UseWebSocketOptions): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;

    let intentionallyClosed = false;
    let socket: SocketLike | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const url = `${defaultUrl()}?token=${encodeURIComponent(token)}`;
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
  }, [token, makeSocket, qc]);
}
