// Shared class strings for the edit drawers' form fields. Literal strings so Tailwind can see them.

/** A bare input/select inside a FieldBox. */
export const FIELD_CONTROL = 'w-full bg-transparent text-[16px] font-semibold text-fg outline-none';

/** The red validation line under a field (and the drawer-level error line). */
export const FIELD_ERROR = 'mt-0.5 text-[11px] text-danger';

/** Spans both columns of a drawer's md:grid-cols-2 grid. `col-span-2` in the one-column grid
 *  below md would conjure a second column, hence the explicit `col-span-1`. */
export const FULL_ROW = 'col-span-1 md:col-span-2';
