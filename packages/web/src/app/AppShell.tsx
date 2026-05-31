import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar onNewTask={() => setNewTaskOpen(true)} />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskPlaceholder onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}

// Temporary stand-in until Task 4 replaces it with the real NewTaskModal.
function NewTaskPlaceholder({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="new-task-modal" className="fixed inset-0 z-50 flex animate-fade items-start justify-center bg-[rgba(24,26,42,.35)] pt-[70px]" onClick={onClose}>
      <div className="animate-pop rounded-[18px] bg-card p-6 shadow-modal" onClick={(e) => e.stopPropagation()}>New Task</div>
    </div>
  );
}
