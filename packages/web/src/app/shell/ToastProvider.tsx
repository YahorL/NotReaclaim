import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePrefersReducedMotion } from '../../theme/usePrefersReducedMotion';
import { Icons } from './icons';

/** Enter + hold + exit, matching `--dur-toast` (the `animate-toast` keyframe length). */
export const TOAST_MS = 2400;

export type ToastIcon = 'lock' | 'check' | 'warning';

export interface ToastApi {
  /** Show `text` now, replacing any toast on screen. */
  show: (text: string, opts?: { icon?: ToastIcon }) => void;
  /**
   * Anchor the visible pill in a caller's container (the Planner's calendar panel, P4) instead
   * of the viewport; null restores the default. Use as a ref callback. The live region stays in
   * the shell either way, so screen readers announce identically.
   */
  setAnchor: (el: HTMLElement | null) => void;
}

// Outside a provider (pages rendered bare in tests) a toast is a silent no-op, not a crash.
const NOOP: ToastApi = { show: () => {}, setAnchor: () => {} };
const ToastContext = createContext<ToastApi>(NOOP);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

interface Current { key: number; text: string; icon: ToastIcon | null }

/**
 * Shell-level toast: one at a time (newest replaces), auto-cleared after 2.4s, in an
 * always-mounted `role=status` region bottom-centre of the viewport, above the mobile tab bar.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const reduced = usePrefersReducedMotion();

  const show = useCallback((text: string, opts?: { icon?: ToastIcon }) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current += 1;
    setCurrent({ key: seq.current, text, icon: opts?.icon ?? null });
    timer.current = setTimeout(() => { timer.current = null; setCurrent(null); }, TOAST_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const api = useMemo<ToastApi>(() => ({ show, setAnchor }), [show]);

  const Icon = current?.icon === 'lock' ? Icons.lock : current?.icon === 'check' ? Icons.check : current?.icon === 'warning' ? Icons.warning : null;
  // Keyed per show(), so a replacement restarts the enter animation. Under reduced motion the
  // keyframe is left off entirely: it ends at opacity 0, and the kill switch would collapse it
  // to that end state at once, hiding the text.
  const pill = current && (
    <span
      key={current.key}
      data-testid="toast"
      data-icon={current.icon ?? undefined}
      data-animated={!reduced}
      className={reduced ? 'toast' : 'toast animate-toast'}
    >
      {Icon && <Icon size={15} />}
      {current.text}
    </span>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        data-testid="toast-region"
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(72px_+_env(safe-area-inset-bottom))] z-[70] flex justify-center px-4 md:bottom-8"
      >
        {anchor ? current && <span className="sr-only">{current.text}</span> : pill}
      </div>
      {anchor && pill && createPortal(pill, anchor)}
    </ToastContext.Provider>
  );
}
