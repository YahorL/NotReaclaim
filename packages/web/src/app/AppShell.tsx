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
    // Toggle when unpinned: the TopBar button both opens and closes the slide-in rail
    // (there is no backdrop to dismiss it anymore).
    setOverlayOpen((v) => !v);
  }

  // The sidebar lives in flow inside a width-animated wrapper: showing/hiding slides it in
  // and pushes the main content (no floating overlay / backdrop). `visible` covers both the
  // pinned state and the temporarily-opened-while-unpinned state.
  const visible = pinned || overlayOpen;

  return (
    <div className="flex h-screen overflow-hidden">
      <div
        data-testid="sidebar-rail"
        aria-hidden={!visible}
        // `inert` (presence-based boolean attr) keeps the clipped sidebar's links/buttons out of
        // the tab order while collapsed. Spread conditionally — React 18 has no boolean `inert` prop.
        {...(!visible ? { inert: '' } : {})}
        className={`shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${visible ? 'w-[280px]' : 'w-0'}`}
      >
        <Sidebar pinned={pinned} onUnpin={handleUnpin} onPin={handlePin} isOverlay={!pinned} />
      </div>

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
