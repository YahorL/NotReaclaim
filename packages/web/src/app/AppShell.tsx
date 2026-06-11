import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './shell/TopBar';
import { useAuth } from '../auth/AuthContext';
import { useWebSocket } from '../realtime/useWebSocket';
import { NewTaskModal } from './shell/NewTaskModal';

function readPinned(): boolean {
  try {
    return localStorage.getItem('nr.sidebarPinned') !== '0';
  } catch {
    return true;
  }
}

function writePinned(val: boolean): void {
  try {
    localStorage.setItem('nr.sidebarPinned', val ? '1' : '0');
  } catch {
    // ignore
  }
}

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [pinned, setPinned] = useState<boolean>(readPinned);
  const [overlayOpen, setOverlayOpen] = useState(false);

  function handleUnpin() {
    setPinned(false);
    writePinned(false);
    setOverlayOpen(false);
  }

  function handlePin() {
    setPinned(true);
    writePinned(true);
    setOverlayOpen(false);
  }

  function handleShowSidebar() {
    setOverlayOpen(true);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {pinned && (
        <Sidebar pinned onUnpin={handleUnpin} onPin={handlePin} isOverlay={false} />
      )}

      {!pinned && overlayOpen && (
        <>
          {/* backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setOverlayOpen(false)}
            aria-hidden="true"
          />
          <div className="fixed left-0 top-0 z-50 h-full transition-transform duration-200">
            <Sidebar pinned={false} onUnpin={handleUnpin} onPin={handlePin} isOverlay />
          </div>
        </>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onNewTask={() => setNewTaskOpen(true)}
          onShowSidebar={handleShowSidebar}
          sidebarPinned={pinned}
        />
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} />}
    </div>
  );
}
