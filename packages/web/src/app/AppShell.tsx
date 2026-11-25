import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
import { RecentlyCreatedProvider } from './shell/RecentlyCreated';

const SIDEBAR_HIDDEN_KEY = 'nr.sidebarHidden';

/**
 * Publishes the content area's top edge as `--drawer-top` on the shell root, for the fixed desktop
 * drawer slot (DESKTOP_DRAWER_SLOT). The header wraps below ~1150px and the Google banner can sit
 * above the content, so a hard-coded offset let a drawer cover Search / New task / the avatar.
 * Observing the content box is enough: its height changes whenever anything above it grows.
 */
function useDrawerTopVar(rootRef: RefObject<HTMLElement>, contentRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const top = Math.round(content.getBoundingClientRect().top);
      // Never publish 0 (hidden/unlaid-out): the slot's own 120px fallback is better than y=0.
      if (top > 0) root.style.setProperty('--drawer-top', `${top}px`);
      else root.style.removeProperty('--drawer-top');
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(content);
    return () => ro.disconnect();
  }, [rootRef, contentRef]);
}

export function AppShell() {
  const { token } = useAuth();
  useWebSocket({ token });
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // The control that opened the dialog, so focus can return there. Taken from the click itself:
  // a click does not focus a <button> in Safari, so document.activeElement would be <body>.
  const newTaskOpenerRef = useRef<HTMLElement | null>(null);
  const openNewTask = (e?: { currentTarget: EventTarget | null }) => {
    const target = e?.currentTarget ?? document.activeElement;
    newTaskOpenerRef.current = target instanceof HTMLElement ? target : null;
    setNewTaskOpen(true);
  };
  const [searchOpen, setSearchOpen] = useState(false);
  // The task the palette opened, edited in the shell-hosted drawer.
  const [searchedTaskId, setSearchedTaskId] = useState<string | null>(null);
  const tasksQ = useTasksQuery();
  const zone = useTimezone();
  useTaskSearchShortcut(() => setSearchOpen(true));
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useDrawerTopVar(rootRef, contentRef);
  // Storage can throw (blocked site data, private mode, quota): the toggle then just isn't remembered.
  const [sidebarHidden, setSidebarHidden] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true'; } catch { return false; }
  });

  function toggleSidebar() {
    setSidebarHidden((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(next)); } catch { /* not remembered */ }
      return next;
    });
  }

  // Desktop frame (prototype): 20px page padding, rail + content column 20px apart, header 20px
  // above the page. Phones keep the edge-to-edge chrome.
  return (
    <ToastProvider>
      <RecentlyCreatedProvider>
      <div ref={rootRef} data-testid="app-shell" className="flex h-dvh overflow-hidden bg-page md:gap-5 md:p-5">
        {!sidebarHidden && <Sidebar />}
        <main className="flex min-w-0 flex-1 flex-col md:gap-5">
          <TopBar onNewTask={openNewTask} onSearch={() => setSearchOpen(true)} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebar} />
          <MobileTopBar onNewTask={openNewTask} />
          <GoogleBrokenBanner />
          {/* The tab bar is `fixed`, so the scroll area reserves its height (56px) plus the
              home-indicator inset below md. Tailwind turns the `_` into a space in calc().
              At md+ the scroller bleeds 20px into the frame's side/bottom padding and pads it back
              (`-mx-5 -mb-5 px-5 pb-5`): content sits exactly where it did, but the panels' soft
              shadows now fade out inside the scroll box instead of being cut at its edge (a faint
              hard rectangle around the content in light). The top edge stays put: `--drawer-top`
              measures it. */}
          <div
            ref={contentRef}
            data-testid="shell-content"
            className="min-h-0 flex-1 overflow-auto pb-[calc(56px_+_env(safe-area-inset-bottom))] md:-mx-5 md:-mb-5 md:px-5 md:pb-5"
          >
            <Outlet />
          </div>
        </main>
        <MobileTabBar />
        {newTaskOpen && <NewTaskModal opener={newTaskOpenerRef} onClose={() => setNewTaskOpen(false)} />}
        {searchedTaskId && <ShellTaskDrawer taskId={searchedTaskId} onClose={() => setSearchedTaskId(null)} />}
        {searchOpen && (
          <TaskSearchPalette
            tasks={tasksQ.data ?? []} zone={zone}
            onClose={() => setSearchOpen(false)}
            onSelect={(id) => { setSearchOpen(false); setSearchedTaskId(id); }}
          />
        )}
      </div>
      </RecentlyCreatedProvider>
    </ToastProvider>
  );
}
