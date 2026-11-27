import { useEffect } from 'react';
import type { Mutation } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { plannerWriteOf, type PlannerWriteOp } from '../../api/queries';
import { saveErrorText } from '../lib/saveError';
import { useToast } from './ToastProvider';

/** A block edit (move, resize, Unpin, Start, Stop) whose block a replan removed while it waited. */
// "or removed": the web cannot tell a replan from another tab's delete or a task completed
// elsewhere (and a running piece in automatic tracking is never re-planned at all).
export const BLOCK_REPLANNED_TEXT = "That block was re-planned or removed while you were editing it. Your change wasn't applied.";
/** A warning toast stays this long: these messages run to 10–15 words. */
export const WARNING_TOAST_MS = 6000;
/** A task dropped on the planner that was deleted meanwhile (POST /schedule answered 404). */
export const TASK_GONE_TEXT = "That task no longer exists, so it wasn't scheduled.";
/** An app event moved after it was deleted elsewhere. */
export const EVENT_GONE_TEXT = "That event no longer exists. Your change wasn't applied.";

/**
 * What to tell the user about a failed planner write, or null for nothing. A 404 says why the
 * change could not land (the block, task or event is gone); a delete answered 404 needs no message
 * — what the user wanted gone is gone. Everything else reads like every other failed save.
 */
export function plannerWriteErrorText(op: PlannerWriteOp, error: unknown): string | null {
  if (error instanceof ApiError && error.status === 404) {
    switch (op) {
      case 'blockUpdate': case 'blockStart': case 'blockStop': return BLOCK_REPLANNED_TEXT;
      case 'blockCreate': return TASK_GONE_TEXT;
      case 'eventUpdate': return EVENT_GONE_TEXT;
      case 'blockDelete': case 'eventDelete': return null;
    }
  }
  return saveErrorText(error);
}

/**
 * Shell-level: every failed planner write, from whichever surface sent it (grid drag/resize/keys,
 * tile ×, detail card, top bar, mobile bar, Next-up card, panel drop), raises one shell toast
 * (`role=status`, polite). A write whose surface shows the error inline (`inlineErrors`) is
 * skipped only while that surface is still mounted to show it: a create popover closed while its
 * POST waited has no inline error left, so the toast speaks instead.
 *
 * "Still mounted" = the mutation still has an observer. TanStack (5.100) keeps a mutation's
 * observers private, so they are counted from the cache's `observerAdded` / `observerRemoved`
 * events; a `useMutation` that unmounts unsubscribes and removes itself (MutationObserver
 * `onUnsubscribe` → `removeObserver`). Mounted in the shell, so it sees every write from its start.
 * Renders nothing.
 */
export function PlannerWriteFeedback(): null {
  const qc = useQueryClient();
  const { show } = useToast();
  useEffect(() => {
    const observed = new WeakMap<Mutation<unknown, Error, unknown, unknown>, Set<unknown>>();
    return qc.getMutationCache().subscribe((e) => {
      if (e.type === 'observerAdded' || e.type === 'observerRemoved') {
        const set = observed.get(e.mutation) ?? new Set<unknown>();
        if (e.type === 'observerAdded') set.add(e.observer); else set.delete(e.observer);
        observed.set(e.mutation, set);
        return;
      }
      if (e.type !== 'updated' || e.action.type !== 'error') return;
      const w = plannerWriteOf(e.mutation);
      if (!w) return;
      if (w.inlineErrors && (observed.get(e.mutation)?.size ?? 0) > 0) return;
      const text = plannerWriteErrorText(w.op, e.action.error);
      if (text) show(text, { icon: 'warning', durationMs: WARNING_TOAST_MS });
    });
  }, [qc, show]);
  return null;
}
