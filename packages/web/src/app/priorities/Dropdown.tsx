import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useClickOutside } from '../components/useClickOutside';

const ITEM_SELECTOR = '[role="menuitemcheckbox"]';

/**
 * A `.btn-glass` pill opening a glass menu of checkbox rows. WAI-ARIA menu-button pattern (same as
 * the shell's AccountMenu): opening focuses the first row, ↑/↓/Home/End move between rows, Escape
 * closes and returns focus to the trigger, Tab closes and lets focus move on. A row toggles in
 * place and keeps the menu open, so several columns can be flipped in one visit. An outside press
 * closes without moving focus.
 */
export function Dropdown({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, close, open);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    switch (e.key) {
      // preventDefault, not stopPropagation: document-level Escape listeners skip handled events.
      case 'Escape': e.preventDefault(); setOpen(false); buttonRef.current?.focus(); break;
      case 'ArrowDown': focusAt(i + 1); break;
      case 'ArrowUp': focusAt(i - 1); break;
      case 'Home': focusAt(0); break;
      case 'End': focusAt(items.length - 1); break;
      case 'Tab': setOpen(false); break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        data-active={open || undefined}
        className="btn-glass inline-flex h-[42px] items-center gap-2 rounded-pill px-4 text-[14px] font-medium data-[active]:bg-fg/[.12]"
      >
        {icon}{label}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="glass-dialog absolute right-0 top-[calc(100%+8px)] z-40 w-[240px] animate-pop rounded-card p-1.5"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** A labelled run of rows inside a Dropdown menu. */
export function MenuGroup({ heading, children }: { heading: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <div id={id} className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-2">{heading}</div>
      {children}
    </div>
  );
}

export function MenuRow({ label, checked, dotClass, onClick }: { label: string; checked: boolean; dotClass?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      tabIndex={-1}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-input px-3 py-2 text-left text-[14px] font-medium text-fg hover:bg-fg/[.07] focus-visible:bg-fg/[.07] focus-visible:outline-offset-[-2px]"
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition-colors ${checked ? 'border-accent bg-accent text-on-accent' : 'border-fg/35 bg-fg/[.04]'}`}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
        )}
      </span>
      {dotClass && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />}
      <span className="flex-1">{label}</span>
    </button>
  );
}
