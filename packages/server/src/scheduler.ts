export interface PollCycleDeps {
  listConnectedIds: () => Promise<string[]>;
  pollAndReplan: (userId: string) => Promise<void>;
  log?: (err: unknown) => void;
}

/** Run one poll cycle: list connected users and re-plan each, isolating per-user failures. */
export async function runPollCycle(deps: PollCycleDeps): Promise<void> {
  const ids = await deps.listConnectedIds();
  for (const id of ids) {
    try {
      await deps.pollAndReplan(id);
    } catch (err) {
      deps.log?.(err);
    }
  }
}

export interface SchedulerDeps extends PollCycleDeps {
  intervalMs: number;
}

/** Thin impure shell: drive runPollCycle on an interval with a re-entrancy guard. Used only by server.ts (never in unit tests). */
export function startScheduler(deps: SchedulerDeps): { stop: () => void } {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runPollCycle(deps)
      .catch((err) => deps.log?.(err))
      .finally(() => {
        running = false;
      });
  }, deps.intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
