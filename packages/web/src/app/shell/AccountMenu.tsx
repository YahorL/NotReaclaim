import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from './icons';
import { useClickOutside } from '../components/useClickOutside';

const ITEM = 'block w-full rounded-input px-3.5 py-2 text-left text-[15px] font-medium text-fg outline-none hover:bg-fg/[.07] focus-visible:bg-fg/[.07]';

/**
 * The header avatar: a generic person glyph (no name/email is known client-side) opening a
 * glass menu with Settings and Sign out. WAI-ARIA menu-button pattern: opening focuses the first
 * item, ↑/↓/Home/End move between items, Escape closes and returns focus to the button, Tab
 * closes and lets focus move on. An outside press closes without moving focus (the press may be
 * focusing something else), so this does not use the modal focus trap.
 */
export function AccountMenu() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(rootRef, close, open);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const closeAndRefocus = () => { setOpen(false); buttonRef.current?.focus(); };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => { e.preventDefault(); items[(n + items.length) % items.length]?.focus(); };
    switch (e.key) {
      case 'Escape': e.preventDefault(); closeAndRefocus(); break;
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
        type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}
        className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full border border-white/25 bg-[linear-gradient(140deg,#8B73FF,#3F2DB8)] text-white transition-transform duration-150 active:scale-[.96] [[data-theme=light]_&]:border-[rgba(17,18,20,0.25)] [[data-theme=light]_&]:bg-[linear-gradient(140deg,#5B67F5,#3F2DB8)]"
      >
        <Icons.user size={20} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="glass-dialog absolute right-0 top-[calc(100%+8px)] z-40 w-[200px] animate-pop rounded-card p-1.5"
        >
          <NavLink to="/settings" role="menuitem" tabIndex={-1} onClick={close} className={ITEM}>
            Settings
          </NavLink>
          <button type="button" role="menuitem" tabIndex={-1} onClick={signOut} className={ITEM}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
