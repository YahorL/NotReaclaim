import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ApiProvider, useApi } from './ApiProvider';
import type { ApiClient } from './client';

const stub = { getConsentUrl: async () => ({ url: 'u' }) } as unknown as ApiClient;

function Probe() {
  const api = useApi();
  return <div>{typeof api.getConsentUrl}</div>;
}

describe('useApi', () => {
  it('returns the client provided by ApiProvider', () => {
    render(
      <ApiProvider client={stub}>
        <Probe />
      </ApiProvider>,
    );
    expect(screen.getByText('function')).toBeInTheDocument();
  });

  it('throws when used outside an ApiProvider', () => {
    expect(() => render(<Probe />)).toThrow(/ApiProvider/);
  });
});
