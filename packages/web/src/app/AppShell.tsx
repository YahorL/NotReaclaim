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
import { TaskSearchPalette, useTaskSearchShortcut } from './shell/TaskSearchPalette';
import { ShellTaskDrawer } from './shell/ShellTaskDrawer';
import { useTasksQuery } from '../api/queries';
import { useTimezone } from './settings/useTimezone';
import { ToastProvider } from './shell/ToastProvider';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The task the palette opened, edited in the shell-hosted drawer.
  const [searchedTaskId, setSearchedTaskId] = useState<string | null>(null);
  const tasksQ = useTasksQuery();
  const zone = useTimezone();
  useTaskSearchShortcut(() => setSearchOpen(true));
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

  // Desktop frame (prototype): 20px page padding, rail + content column 20px apart, header 20px
  // above the page. Phones keep the edge-to-edge chrome.
  return (
    <ToastProvider>
      <div className="flex h-dvh overflow-hidden bg-page md:gap-5 md:p-5">
        {!sidebarHidden && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col md:gap-5">
          <TopBar onNewTask={() => setNewTaskOpen(true)} onSearch={() => setSearchOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
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
        {searchedTaskId && <ShellTaskDrawer taskId={searchedTaskId} onClose={() => setSearchedTaskId(null)} />}
        {searchOpen && (
          <TaskSearchPalette
            tasks={tasksQ.data ?? []} zone={zone}
            onClose={() => setSearchOpen(false)}
            onSelect={(id) => { setSearchOpen(false); setSearchedTaskId(id); }}
          />
        )}
      </div>
    </ToastProvider>
  );
}
