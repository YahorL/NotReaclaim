import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import { plannerWriteOf, type PlannerWriteOp } from '../../api/queries';
import { saveErrorText } from '../lib/saveError';
import { useToast } from './ToastProvider';

/** A block edit (move, resize, Unpin, Start, Stop) whose block a replan removed while it waited. */
export const BLOCK_REPLANNED_TEXT = "That block was re-planned while you were editing it. Your change wasn't applied.";
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
 * (`role=status`, polite). Writes whose surface shows the error inline (`inlineErrors`) are skipped.
 * Renders nothing.
 */
export function PlannerWriteFeedback(): null {
  const qc = useQueryClient();
  const { show } = useToast();
  useEffect(() => qc.getMutationCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'error') return;
    const w = plannerWriteOf(e.mutation);
    if (!w || w.inlineErrors) return;
    const text = plannerWriteErrorText(w.op, e.action.error);
    if (text) show(text, { icon: 'warning' });
  }), [qc, show]);
  return null;
}
