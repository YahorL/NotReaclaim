import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Icons } from './icons';

export function AccountMenu() {
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-label="Account menu" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-[30px] py-1 pl-1 pr-1.5"
      >
        <span className="h-[38px] w-[38px] rounded-full" style={{ background: 'conic-gradient(from 140deg, #7c87ff, #6ee0c8, #ffd166, #f4b8c2, #7c87ff)' }} />
        <Icons.chevDown size={16} className="text-inkSoft" />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 w-[200px] animate-pop rounded-xl border border-line bg-card p-1.5 shadow-pop">
          <NavLink to="/settings" onClick={() => setOpen(false)} className="block rounded-lg px-3.5 py-2 text-[15px] font-semibold text-ink hover:bg-bg">
            Settings
          </NavLink>
          <button type="button" onClick={signOut} className="block w-full rounded-lg px-3.5 py-2 text-left text-[15px] font-semibold text-ink hover:bg-bg">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
