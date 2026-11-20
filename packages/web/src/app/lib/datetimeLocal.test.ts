import { describe, it, expect } from 'vitest';
import { isoToZonedInput, zonedInputToIso, zonedDayAtInput } from './datetimeLocal';

describe('datetimeLocal', () => {
  it('isoToZonedInput / zonedInputToIso round-trip in UTC', () => {
    expect(isoToZonedInput('2026-06-01T17:00:00.000Z', 'UTC')).toBe('2026-06-01T17:00');
    expect(zonedInputToIso('2026-06-01T17:00', 'UTC')).toBe('2026-06-01T17:00:00.000Z');
  });

  it('reads and writes wall-clock in the given zone', () => {
    expect(isoToZonedInput('2026-06-01T02:00:00.000Z', 'America/New_York')).toBe('2026-05-31T22:00');
    expect(zonedInputToIso('2026-05-31T22:00', 'America/New_York')).toBe('2026-06-01T02:00:00.000Z');
    expect(isoToZonedInput('2026-06-01T20:00:00.000Z', 'Asia/Tokyo')).toBe('2026-06-02T05:00');
    expect(zonedInputToIso('2026-06-02T05:00', 'Asia/Tokyo')).toBe('2026-06-01T20:00:00.000Z');
  });

  it('returns empty / null for unparseable input', () => {
    expect(isoToZonedInput('nope', 'UTC')).toBe('');
    expect(zonedInputToIso('nope', 'UTC')).toBeNull();
  });
});

describe('zonedInputToIso across New York DST transitions (documents luxon 3 behaviour)', () => {
  it('spring-forward gap: a skipped wall time moves forward by the gap (02:30 → 03:30 EDT)', () => {
    // 2026-03-08 02:00–03:00 does not exist in New York.
    expect(zonedInputToIso('2026-03-08T02:30', 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
    expect(isoToZonedInput('2026-03-08T07:30:00.000Z', 'America/New_York')).toBe('2026-03-08T03:30');
  });

  it('fall-back overlap: both 01:30s show as "01:30", which converts back to the LATER one (EST, −05:00)', () => {
    // 2026-11-01 01:00–02:00 happens twice: first in EDT (−04:00), then in EST (−05:00).
    expect(isoToZonedInput('2026-11-01T05:30:00.000Z', 'America/New_York')).toBe('2026-11-01T01:30'); // EDT pass
    expect(isoToZonedInput('2026-11-01T06:30:00.000Z', 'America/New_York')).toBe('2026-11-01T01:30'); // EST pass
    expect(zonedInputToIso('2026-11-01T01:30', 'America/New_York')).toBe('2026-11-01T06:30:00.000Z');
  });
});

describe('zonedDayAtInput', () => {
  it('lands on the settings-zone calendar day, not the UTC one', () => {
    // 02:00Z Jan 7 is Jan 6 in New York; 20:00Z Jan 6 is Jan 7 in Tokyo.
    expect(zonedDayAtInput(Date.parse('2026-01-07T02:00:00.000Z'), 'America/New_York', 0, 8, 0)).toBe('2026-01-06T08:00');
    expect(zonedDayAtInput(Date.parse('2026-01-06T20:00:00.000Z'), 'Asia/Tokyo', 7, 23, 59)).toBe('2026-01-14T23:59');
  });

  it('counts calendar days across a DST change (New York spring-forward)', () => {
    expect(zonedDayAtInput(Date.parse('2026-03-08T04:30:00.000Z'), 'America/New_York', 7, 23, 59)).toBe('2026-03-14T23:59');
  });

  it('never returns a day before the day containing notBeforeMs', () => {
    const now = Date.parse('2026-01-05T12:00:00.000Z');
    expect(zonedDayAtInput(now, 'Pacific/Auckland', 7, 23, 59, Date.parse('2026-01-20T11:30:00.000Z'))).toBe('2026-01-21T23:59');
    expect(zonedDayAtInput(now, 'Pacific/Auckland', 7, 23, 59, now)).toBe('2026-01-13T23:59');
  });
});
