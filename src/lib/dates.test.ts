import { describe, expect, it } from 'vitest';

import { dayOfWeek, formatDate, relativeDays } from './dates.js';

describe('dayOfWeek', () => {
  it('returns Monday for 2026-05-11', () => {
    expect(dayOfWeek('2026-05-11')).toBe('Monday');
  });

  it('returns Thursday for 2026-05-07', () => {
    expect(dayOfWeek('2026-05-07')).toBe('Thursday');
  });

  it('returns Saturday for 2026-01-03', () => {
    expect(dayOfWeek('2026-01-03')).toBe('Saturday');
  });

  it('handles full ISO datetime strings', () => {
    expect(dayOfWeek('2026-05-11T14:30:00Z')).toBe('Monday');
  });
});

describe('formatDate', () => {
  it('formats with a custom pattern', () => {
    expect(formatDate('2026-05-11', 'EEEE d MMMM yyyy')).toBe(
      'Monday 11 May 2026',
    );
  });

  it('formats as ISO date', () => {
    expect(formatDate('2026-05-11', 'yyyy-MM-dd')).toBe('2026-05-11');
  });
});

describe('relativeDays', () => {
  it('returns "today" for same date', () => {
    expect(relativeDays('2026-05-11', '2026-05-11')).toBe('today');
  });

  it('returns "tomorrow" for next day', () => {
    expect(relativeDays('2026-05-12', '2026-05-11')).toBe('tomorrow');
  });

  it('returns "yesterday" for previous day', () => {
    expect(relativeDays('2026-05-10', '2026-05-11')).toBe('yesterday');
  });

  it('returns relative description for further dates', () => {
    const result = relativeDays('2026-05-20', '2026-05-11');
    expect(result).toMatch(/in \d+ days/);
  });

  it('returns relative description for past dates', () => {
    const result = relativeDays('2026-05-01', '2026-05-11');
    expect(result).toMatch(/\d+ days ago/);
  });
});
