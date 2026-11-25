import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

// `.btn-accent` / `.btn-glass` (index.css) carry colour, shadow, hover, :active scale and :disabled.
const PRIMARY = 'btn-accent inline-flex items-center justify-center gap-2 rounded-pill px-5 py-2 text-[14px] font-semibold';
const PRIMARY_LARGE = 'btn-accent inline-flex h-[46px] items-center justify-center gap-2 rounded-pill px-[30px] text-[16px] font-semibold';
const SECONDARY = 'btn-glass inline-flex items-center justify-center rounded-pill px-5 py-2 text-[14px] font-semibold';

/** The lime accent pill (drawer Save). `large` (46px) is the new-task modal's Create button. */
export function PrimaryButton({ large = false, ...props }: ButtonProps & { large?: boolean }) {
  return <button {...props} className={large ? PRIMARY_LARGE : PRIMARY} />;
}

/** The glass pill beside a PrimaryButton (drawer Cancel). */
export function SecondaryButton(props: ButtonProps) {
  return <button {...props} className={SECONDARY} />;
}
