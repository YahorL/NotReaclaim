import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icons } from '../shell/icons';

export function Dropdown({ icon, label, width = 240, children }: { icon: ReactNode; label: string; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className={`flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[15.5px] font-bold text-indigo ${open ? 'bg-indigoSoft' : 'hover:bg-indigoSoft'}`}>
        {icon} {label} {open ? <Icons.chevUp size={16} /> : <Icons.chevDown size={16} />}
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-40 animate-pop rounded-xl border border-line bg-card p-1.5 shadow-pop" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuRow({ label, checked, dotClass, onClick }: { label: string; checked?: boolean; dotClass?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2 text-left text-[15px] font-semibold text-ink hover:bg-bg">
      <span className={`flex h-[19px] w-[19px] items-center justify-center rounded-[5px] ${checked ? 'bg-indigo text-white' : 'border-2 border-[#c7cad6]'}`}>{checked && <Icons.check size={13} />}</span>
      {dotClass && <span className={`h-2.5 w-2.5 rounded-[3px] ${dotClass}`} />}
      <span className="flex-1">{label}</span>
    </button>
  );
}
