import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';
import { NewTaskModal } from './shell/NewTaskModal';

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
    <div className="flex h-screen overflow-hidden">
      {!sidebarHidden && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}
