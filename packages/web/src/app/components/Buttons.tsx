import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

const PRIMARY = 'rounded-[30px] bg-indigo px-5 py-2 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50';
const PRIMARY_LARGE = 'rounded-[30px] bg-indigo px-[34px] py-3 text-[17px] font-bold text-white shadow-[0_4px_12px_rgba(91,98,227,.35)] hover:bg-indigo600 disabled:opacity-50';
const SECONDARY = 'rounded-[30px] border border-line px-5 py-2 text-[14px] font-bold text-inkSoft hover:bg-bg';

/** The filled indigo pill (drawer Save). `large` is the new-task modal's Create button. */
export function PrimaryButton({ large = false, ...props }: ButtonProps & { large?: boolean }) {
  return <button {...props} className={large ? PRIMARY_LARGE : PRIMARY} />;
}

/** The outlined pill beside a PrimaryButton (drawer Cancel). */
export function SecondaryButton(props: ButtonProps) {
  return <button {...props} className={SECONDARY} />;
}
