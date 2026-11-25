// Shared class strings for the P7 screens (Buffers, Hours, Settings, Habits, auth). Literal strings
// so Tailwind's JIT sees them. Values are the prototypes' `.lbl`, `.num`/`.ctl`/`.tm`/`.name`/`.inp`,
// `.cb` and `.step`, rewritten on tokens so the light theme comes for free. The drawers' field
// boxes keep `components/formStyles.ts` (P2-owned).

/** Small uppercase card caption ("BUFFER AROUND MEETINGS", "WORKING HOURS"). */
export const CAPS_LABEL = 'text-[12px] uppercase tracking-[0.08em] text-fg-2';

/** Recessed input surface. It drops the outline, so the full-strength focus border is the cue (spec §6). */
export const INPUT = 'rounded-input border border-fg/10 bg-fg/[.05] text-fg outline-none transition-colors placeholder:text-fg-3 focus:border-focus disabled:opacity-40';

/**
 * Custom checkbox (prototype `.cb`): 20px rounded square, accent fill + on-accent tick when checked.
 * Still a native `<input type="checkbox">` (keyboard, label, form semantics); the tick is a
 * clip-path on `::before`. Grows to 24px on a coarse pointer.
 */
export const CHECKBOX = "grid h-5 w-5 shrink-0 cursor-pointer appearance-none place-content-center rounded-[6px] border-[1.5px] border-fg/35 bg-fg/[.04] transition-colors before:h-[11px] before:w-[11px] before:scale-0 before:bg-on-accent before:transition-transform before:content-[''] before:[clip-path:polygon(14%_44%,0_65%,50%_100%,100%_16%,80%_0%,43%_62%)] checked:border-accent checked:bg-accent checked:before:scale-100 hover:border-accent disabled:cursor-not-allowed disabled:opacity-40 coarse:h-6 coarse:w-6";

/** Destructive text button (prototype `.del`). */
export const DANGER_TEXT_BTN = 'rounded-pill px-3 py-2 text-[13px] text-danger transition-colors hover:bg-danger/[.12] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-fg-3';
