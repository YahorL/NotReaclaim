export const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 24 * 60 * MS_PER_MIN;
/** The planner's slot size in minutes: drags, clicks and durations snap to it. */
export const SLOT_MIN = 15;

/** Epoch ms → ISO-8601 UTC string. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
