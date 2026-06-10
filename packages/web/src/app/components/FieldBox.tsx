import type { ReactNode } from 'react';

/** Reclaim-style bordered field: small grey label inside the box, bold content under it. */
export function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-[11px] border-[1.5px] border-line px-3.5 py-2.5">
      <span className="text-[13px] font-semibold text-inkSoft">{label}</span>
      {children}
    </div>
  );
}
