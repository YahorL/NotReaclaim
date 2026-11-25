import { Link } from 'react-router-dom';

/** The rail's 2×2 dot mark (prototype `.rail-logo`), linking home. */
export function Logo() {
  return (
    <Link
      to="/"
      aria-label="NotReclaim home"
      className="mb-1.5 grid h-12 w-12 shrink-0 grid-cols-2 gap-1 rounded-full border border-fg/[.14] bg-fg/[.08] p-[13px] [@media(max-height:760px)]:mb-0 [@media(max-height:760px)]:h-10 [@media(max-height:760px)]:w-10 [@media(max-height:760px)]:p-[11px] shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
    >
      <span className="rounded-full bg-accent" />
      <span className="rounded-full bg-meeting" />
      <span className="rounded-full bg-meeting" />
      <span className="rounded-full bg-fg" />
    </Link>
  );
}
