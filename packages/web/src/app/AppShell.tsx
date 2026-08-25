import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';
import { NewTaskModal } from './shell/NewTaskModal';
import { GoogleBrokenBanner } from './shell/GoogleBrokenBanner';
import { MobileTopBar } from './shell/MobileTopBar';
import { MobileTabBar } from './shell/MobileTabBar';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(
    () => localStorage.getItem('nr.sidebarHidden') === 'true',
  );

  function toggleSidebar() {
    setSidebarHidden((prev) => {
      const next = !prev;
      localStorage.setItem('nr.sidebarHidden', String(next));
      return next;
    });
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {!sidebarHidden && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
        <MobileTopBar onNewTask={() => setNewTaskOpen(true)} />
        <GoogleBrokenBanner />
        {/* The tab bar is `fixed`, so the scroll area reserves its height (56px) plus the
            home-indicator inset below md. Tailwind turns the `_` into a space in calc(). */}
        <div
          data-testid="shell-content"
          className="min-h-0 flex-1 overflow-auto pb-[calc(56px_+_env(safe-area-inset-bottom))] md:pb-0"
        >
          <Outlet />
        </div>
      </main>
      <MobileTabBar />
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}
