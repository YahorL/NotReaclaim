export const MS_PER_MIN = 60_000;
export const MS_PER_DAY = 24 * 60 * MS_PER_MIN;

/** Epoch ms → ISO-8601 UTC string. */
export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}
