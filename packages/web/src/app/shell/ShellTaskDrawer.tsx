import { useEffect, useRef } from 'react';
import { ApiError } from '../../api/client';
import { useTasksQuery, useUpdateTaskMutation } from '../../api/queries';
import { DrawerHost, DESKTOP_DRAWER_SLOT } from '../components/DrawerHost';
import { useCompactWidth } from '../lib/useMediaQuery';
import { useTimezone } from '../settings/useTimezone';
import { TaskDrawer } from '../tasks/TaskDrawer';

/**
 * The task drawer the search palette opens, hosted by the shell so it works on every route
 * without navigating. Same wiring as the Planner/Priorities drawers; z-[55] puts it above a
 * page-level drawer (z-50) that may already be open in the same slot.
 */
export function ShellTaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const tasksQ = useTasksQuery();
  const task = tasksQ.data?.find((t) => t.id === taskId) ?? null;
  const zone = useTimezone();
  const compact = useCompactWidth();
  const updateTask = useUpdateTaskMutation();
  const hostRef = useRef<HTMLDivElement>(null);
  const hasTask = task !== null;
  // Desktop: the palette that opened this drawer hands focus back to its opener (Search) as it
  // unmounts, and this drawer is rendered last in the DOM — so move focus into it. This must be a
  // passive effect: the palette's restore runs in passive cleanup, which precedes passive mounts
  // but follows autoFocus / layout effects. On close, focus goes back to the opener if it was left
  // on <body>. Compact hosts in a Sheet, whose focus trap does all of this.
  // Captured once: StrictMode's effect re-run would otherwise record the field focused below.
  const openerRef = useRef<Element | null>(null);
  useEffect(() => {
    if (compact || !hasTask) return;
    if (openerRef.current === null) openerRef.current = document.activeElement;
    const previous = openerRef.current;
    hostRef.current
      ?.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]),textarea:not([disabled]),select:not([disabled])')
      ?.focus();
    return () => {
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [compact, hasTask, taskId]);
  if (!task) return null;
  return (
    <DrawerHost compact={compact} label="Edit task" onClose={onClose} hostRef={hostRef} desktopClass={`${DESKTOP_DRAWER_SLOT} z-[55]`}>
      <TaskDrawer
        key={task.id}
        task={task} zone={zone} compact={compact} saving={updateTask.isPending}
        error={updateTask.error instanceof ApiError ? updateTask.error : null}
        onSave={(patch) => updateTask.mutate({ id: task.id, patch }, { onSuccess: onClose })}
        onCancel={onClose}
      />
    </DrawerHost>
  );
}
