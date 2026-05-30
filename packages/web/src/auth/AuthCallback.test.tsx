import { describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { AuthCallback } from './AuthCallback';
import { renderWithProviders } from '../test/fakes';
import { tokenStore } from './tokenStore';

beforeEach(() => localStorage.clear());

function Harness() {
  return (
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/" element={<div>home</div>} />
      <Route path="/signin" element={<div>signin</div>} />
    </Routes>
  );
}

describe('AuthCallback', () => {
  it('stores the token from the fragment and navigates home', async () => {
    renderWithProviders(<Harness />, { initialEntries: ['/auth/callback#token=jwt&userId=u1'] });
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(tokenStore.get()).toEqual({ token: 'jwt', userId: 'u1' });
  });

  it('redirects to signin when the fragment has no token', async () => {
    renderWithProviders(<Harness />, { initialEntries: ['/auth/callback#oops'] });
    expect(await screen.findByText('signin')).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });
});
