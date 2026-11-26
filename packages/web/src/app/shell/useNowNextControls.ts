import { useNavigate } from 'react-router-dom';
import { useStartBlockMutation, useStopBlockMutation, usePendingPlannerWrites } from '../../api/queries';
import { useDelayedFlag } from '../lib/useDelayed';
import { relativeDayTimeLabel } from '../priorities/priorityBucket';
import { useCurrentOrNext } from './currentOrNext';
import { useTimezone } from '../settings/useTimezone';

/** The Now/Next controller shared by the desktop TopBar and the mobile top bar. */
export function useNowNextControls(now: () => number) {
  const navigate = useNavigate();
  const startBlock = useStartBlockMutation();
  const stopBlock = useStopBlockMutation();
  const nowMs = now();
  const zone = useTimezone();
  const { running, nextBlock } = useCurrentOrNext(nowMs);
  const nextTime = nextBlock ? relativeDayTimeLabel(Date.parse(nextBlock.startsAt), nowMs, zone) : null;
  // Read from the shared mutation cache: the desktop pill, the mobile bar and the Next-up card are
  // separate hook instances, and a Start pressed in one must show as pending in all of them.
  const writes = usePendingPlannerWrites();
  const startPending = useDelayedFlag(nextBlock !== null && writes.some((w) => w.op === 'blockStart' && w.target === nextBlock.id));
  const stopPending = useDelayedFlag(running !== null && writes.some((w) => w.op === 'blockStop' && w.target === running.id));
  return {
    running,
    nextBlock,
    /** Start / Stop has been waiting for the server for a while (~400ms): show the button busy. */
    startPending,
    stopPending,
    /** "Today 4:30 PM" in the settings zone. */
    nextTime,
    nextLabel: nextBlock ? `Next · ${nextBlock.title} · ${nextTime}` : null,
    start: () => {
      if (nextBlock) startBlock.mutate(nextBlock.id);
    },
    stop: () => {
      if (running) stopBlock.mutate(running.id);
    },
    openPlanner: () => void navigate('/'),
  };
}
