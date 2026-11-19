import { describe, it, expect } from 'vitest';
import { apiBaseUrl, webSocketUrl } from './baseUrl';

const httpPage = { protocol: 'http:', host: 'app.local:5173', href: 'http://app.local:5173/planner' };
const httpsPage = { protocol: 'https:', host: 'app.example.com', href: 'https://app.example.com/planner' };

describe('apiBaseUrl', () => {
  it('is empty when unset or empty', () => {
    expect(apiBaseUrl(undefined)).toBe('');
    expect(apiBaseUrl('')).toBe('');
  });

  it('passes an absolute URL through', () => {
    expect(apiBaseUrl('https://api.example.com')).toBe('https://api.example.com');
    expect(apiBaseUrl('http://api.local:3000/prefix')).toBe('http://api.local:3000/prefix');
  });

  it('drops trailing slashes so `${base}${path}` never yields a double slash', () => {
    expect(apiBaseUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(apiBaseUrl('https://api.example.com/prefix//')).toBe('https://api.example.com/prefix');
    expect(apiBaseUrl('/')).toBe('');
  });
});

describe('webSocketUrl', () => {
  it('unset/empty base: the page host, exactly as before', () => {
    expect(webSocketUrl('', httpPage)).toBe('ws://app.local:5173/ws');
    expect(webSocketUrl('', httpsPage)).toBe('wss://app.example.com/ws');
  });

  it('absolute http base → ws on that host', () => {
    expect(webSocketUrl('http://api.local', httpsPage)).toBe('ws://api.local/ws');
  });

  it('absolute https base → wss on that host', () => {
    expect(webSocketUrl('https://api.example.com', httpPage)).toBe('wss://api.example.com/ws');
  });

  it('keeps an explicit port', () => {
    expect(webSocketUrl('http://api.local:3000', httpPage)).toBe('ws://api.local:3000/ws');
    expect(webSocketUrl('https://api.example.com:8443', httpPage)).toBe('wss://api.example.com:8443/ws');
  });

  it('keeps a path prefix', () => {
    expect(webSocketUrl('https://example.com/notreclaim', httpPage)).toBe('wss://example.com/notreclaim/ws');
  });

  it('a trailing slash (normalised by apiBaseUrl) gives a single slash', () => {
    expect(webSocketUrl(apiBaseUrl('https://api.example.com/'), httpPage)).toBe('wss://api.example.com/ws');
    expect(webSocketUrl(apiBaseUrl('/'), httpPage)).toBe('ws://app.local:5173/ws');
  });

  it('a root-relative base resolves against the page, like fetch() does for the HTTP client', () => {
    expect(webSocketUrl('/api', httpsPage)).toBe('wss://app.example.com/api/ws');
    expect(webSocketUrl('/api', httpPage)).toBe('ws://app.local:5173/api/ws');
  });
});
