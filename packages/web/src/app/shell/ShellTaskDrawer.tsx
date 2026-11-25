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
  if (!task) return null;
  return (
    <DrawerHost compact={compact} label="Edit task" onClose={onClose} desktopClass={`${DESKTOP_DRAWER_SLOT} z-[55]`}>
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
