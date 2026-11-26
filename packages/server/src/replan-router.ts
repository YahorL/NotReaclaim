import type { RowFailure } from '@notreclaim/core';
import type { ReconcileResult } from '@notreclaim/google';
import { serialisePerUser } from './replan-queue.js';

/** One replan path; `report` is told about every row the apply skipped (see makeReplan). */
export type ReplanPath = (userId: string, now: number, report: (failure: RowFailure) => void) => Promise<ReconcileResult>;

export interface ReplanRouterDeps {
  reconcile: ReplanPath;
  planLocally: ReplanPath;
  isConnected: (userId: string) => Promise<boolean>;
  /** Clock read when a queued replan starts (see serialisePerUser). Defaults to Date.now. */
  clock?: () => number;
  /** Where a replan that skipped rows is reported (server.ts: the app's warn log). */
  warn?: (fields: Record<string, unknown>, message: string) => void;
}

/** The counts that say a replan skipped rows (each retried next cycle). */
const FAILED_COUNTS = ['createFailed', 'updateFailed', 'deleteFailed', 'attachFailed', 'pinnedFailed'] as const;
const MAX_MESSAGE = 300;

/**
 * One log-friendly line: a Prisma known-request error (code `P####`) keeps only its last
 * non-empty line — the rest is an invocation header and a code frame — and all whitespace
 * runs (pretty-printed Google JSON bodies) collapse to one space before the cap.
 */
function logMessage(message: unknown, code: unknown): string {
  const full = toText(message);
  const lines = full.split('\n').filter((line) => line.trim() !== '');
  const text = typeof code === 'string' && /^P\d{4}$/.test(code) && lines.length > 1 ? lines[lines.length - 1]! : full;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_MESSAGE ? `${oneLine.slice(0, MAX_MESSAGE)}…` : oneLine;
}

/** Any value as text, never throwing (a null-prototype object has no toString). */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '[unprintable]';
  }
}

/**
 * What is safe to log of an error: its name, a capped message, and an HTTP status / DB code.
 * No tokens, no bodies beyond that. Total: any thrown value, whatever its shape, is described.
 */
function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: logMessage(error, undefined) };
  const { status, code } = error as { status?: unknown; code?: unknown };
  return {
    name: toText(error.name),
    message: logMessage(error.message, code),
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof code === 'string' ? { code } : {}),
  };
}

/**
 * Re-plan a user's schedule: Google reconcile when connected, else local persist.
 *
 * Serialised per user: every entry point (mutation routes, POST /schedule/replan, the poll)
 * shares this one function, so two replans for the same user never interleave their
 * read-diff-write cycles (duplicate rows / orphaned Google events). See replan-queue.ts.
 *
 * Also the one place every replan passes through, so it is where a replan that skipped rows
 * (isolated per-row failures) is logged: once per replan, with the failed counts and the
 * first error of each kind. The error objects stay here — the returned counts, which the
 * routes send to clients, never carry them.
 */
export function makeReplan(deps: ReplanRouterDeps): (userId: string, now: number) => Promise<ReconcileResult> {
  return serialisePerUser<ReconcileResult>(
    async (userId, now) => {
      const firstPerKind = new Map<RowFailure['kind'], RowFailure>();
      const report = (failure: RowFailure) => {
        if (!firstPerKind.has(failure.kind)) firstPerKind.set(failure.kind, failure);
      };
      // Logging is best effort: it must never turn a replan's outcome into another one.
      const warnSkipped = (failed: unknown) => {
        if (!deps.warn) return;
        try {
          deps.warn({
            userId,
            failed,
            failures: [...firstPerKind.values()].map(({ kind, blockId, engineKey, error }) => ({
              kind, blockId, engineKey, error: describeError(error),
            })),
          }, 'replan skipped blocks that failed to save (retried next cycle)');
        } catch {
          // a failing logger is not the replan's failure
        }
      };
      let result: ReconcileResult;
      try {
        result = (await deps.isConnected(userId))
          ? await deps.reconcile(userId, now, report)
          : await deps.planLocally(userId, now, report);
      } catch (err) {
        // Rows skipped before a fatal error would otherwise never be logged (the caller logs
        // only the fatal error). No counts exist for a failed run.
        if (firstPerKind.size > 0) warnSkipped('unavailable: the replan failed after skipping these rows');
        throw err;
      }
      const failed = Object.fromEntries(FAILED_COUNTS.flatMap((k) => (result[k] ? [[k, result[k]]] : [])));
      if (Object.keys(failed).length > 0) warnSkipped(failed);
      return result;
    },
    { clock: deps.clock },
  );
}
