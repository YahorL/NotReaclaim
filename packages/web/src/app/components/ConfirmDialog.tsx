import { useId, useRef, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from './Sheet';
import { PrimaryButton } from './Buttons';

export interface ConfirmDialogProps {
  title: string;
  /** The consequence, read out as the dialog's description. */
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  /** Cancel, Escape and a press on the backdrop. */
  onCancel: () => void;
}

/**
 * A small modal confirmation in the New task dialog's idiom: `bg-overlay` blurred backdrop, a
 * `.glass-dialog` surface that springs in (`animate-modal-in`, off under reduced motion via the
 * kill switch), Cancel as a glass pill and the action as the accent pill. `role=alertdialog` +
 * `aria-modal` (so planner/shell Escape handlers see an overlay is open), the shared focus trap
 * (Escape = Cancel, Tab stays inside, focus goes back to the opener on close), initial focus on
 * Cancel — the choice that changes nothing. Portalled to <body>: a `.glass` ancestor's
 * backdrop-filter would otherwise trap its `fixed` backdrop inside that card.
 */
export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', onConfirm, onCancel }: ConfirmDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onKeyDown = useFocusTrap(dialogRef, { onEscape: onCancel, initialFocus: () => cancelRef.current });
  const titleId = useId();
  const messageId = useId();
  // Only a press that STARTED on the backdrop closes (a selection dragged out of the dialog doesn't).
  const pressOnBackdrop = useRef(false);

  return createPortal(
    <div
      data-testid="confirm-backdrop"
      onPointerDown={(e) => { pressOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && pressOnBackdrop.current) onCancel(); pressOnBackdrop.current = false; }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay px-4 backdrop-blur-[8px] animate-bd-in"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="glass-dialog flex w-full max-w-[460px] flex-col gap-3.5 rounded-[26px] p-[22px] outline-none animate-modal-in"
      >
        <h2 id={titleId} className="text-[20px] font-medium tracking-[-0.01em] text-fg">{title}</h2>
        <p id={messageId} className="text-[15px] leading-relaxed text-fg-2">{message}</p>
        <div className="flex items-center justify-end gap-3 pt-1">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-glass inline-flex h-[46px] items-center rounded-pill px-6 text-[15px] font-medium text-fg">
            Cancel
          </button>
          <PrimaryButton large type="button" onClick={onConfirm}>{confirmLabel}</PrimaryButton>
        </div>
      </div>
    </div>,
    document.body,
  );
}
