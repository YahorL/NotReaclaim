import { useState, type ReactNode } from 'react';
import { Icons } from '../shell/icons';

export function TasksCard({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-3.5 rounded-xl border border-line bg-card shadow-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-4 py-3.5 text-ink">
        <span className="text-[16px] font-bold">Tasks</span>
        <span className="rounded-md bg-[#eef0f4] px-2 py-px text-[13px] font-bold text-inkSoft">{count}</span>
        <span className="flex-1" />
        {open ? <Icons.chevUp size={18} className="text-inkSoft" /> : <Icons.chevDown size={18} className="text-inkSoft" />}
      </button>
      {open && children}
    </div>
  );
}
