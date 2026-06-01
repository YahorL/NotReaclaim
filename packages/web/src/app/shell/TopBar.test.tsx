import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../auth/AuthContext';
import { TopBar } from './TopBar';

function renderTopBar(onNewTask = vi.fn(), path = '/priorities') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><TopBar onNewTask={onNewTask} /></AuthProvider>
    </MemoryRouter>,
  );
  return onNewTask;
}

describe('TopBar', () => {
  it('shows the page title from the route', () => {
    renderTopBar(vi.fn(), '/priorities');
    expect(screen.getByRole('heading', { name: 'Priorities' })).toBeInTheDocument();
  });

  it('fires onNewTask when New Task is clicked', () => {
    const onNewTask = renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onNewTask).toHaveBeenCalledTimes(1);
  });

  it('opens the account menu to reveal Sign out', () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
