import type { ReactNode } from 'react';
import { INPUT } from '../app/forms/controls';

export const AUTH_LINK = 'font-medium text-accent-fg underline-offset-2 hover:underline';

/** The signed-out frame: one glass card centred on the page, with the 2×2 logo dots. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-page px-4 py-10">
      <div className="glass flex w-full max-w-[380px] animate-rise flex-col gap-4 rounded-panel px-7 py-8">
        <div className="mb-1 flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="grid h-12 w-12 grid-cols-2 gap-1 rounded-pill border border-fg/15 bg-fg/[.08] p-[13px]">
            <span className="rounded-pill bg-accent" />
            <span className="rounded-pill bg-meeting" />
            <span className="rounded-pill bg-meeting" />
            <span className="rounded-pill bg-fg" />
          </span>
          <h1 className="text-[28px] font-light tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="text-[14px] text-fg-2">{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function AuthField({ id, label, value, onChange, type = 'text', ...rest }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] text-fg-2" htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={`${INPUT} h-11 px-3.5 text-[15px]`} {...rest} />
    </div>
  );
}
