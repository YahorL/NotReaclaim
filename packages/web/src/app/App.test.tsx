import { describe, it, expect, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { App } from './App';
import { renderWithProviders } from '../test/fakes';
import { tokenStore } from '../auth/tokenStore';

beforeEach(() => localStorage.clear());

describe('App routing', () => {
  it('redirects to /signin when unauthenticated', () => {
    renderWithProviders(<App />, { initialEntries: ['/'] });
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('renders the shell with nav links when authenticated', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    expect(screen.getByRole('link', { name: 'Planner' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tasks' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Habits' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('navigates to the Habits page via the sidebar', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('link', { name: 'Habits' }));
    expect(screen.getByText(/arrives in 5c/i)).toBeInTheDocument();
  });

  it('signs out back to /signin', () => {
    tokenStore.set({ token: 'jwt', userId: 'u1' });
    renderWithProviders(<App />, { initialEntries: ['/'] });
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument();
  });
});
