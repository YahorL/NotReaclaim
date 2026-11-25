import { useNavigate } from 'react-router-dom';
import { useStartBlockMutation, useStopBlockMutation } from '../../api/queries';
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
  return {
    running,
    nextBlock,
    /** "Today 4:30pm" in the settings zone. */
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
