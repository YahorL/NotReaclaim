import type { ReactNode } from 'react';

/** Glass field card: small muted label inside the box, the control under it. The accent border on
 *  focus-within is the focus cue, since the bare controls inside drop their own outline. */
export function FieldBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="glass-card flex min-w-0 flex-1 flex-col gap-0.5 rounded-field px-4 py-3 transition-colors focus-within:border-accent-fg/60">
      <span className="text-[13px] font-medium text-fg-2">{label}</span>
      {children}
    </div>
  );
}
