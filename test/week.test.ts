import { describe, it, expect } from 'vitest';
import { completedWeek, isInSeason } from '../src/week.js';

const WEEK_1_RECAP_TUESDAY = '2026-09-15';

describe('completedWeek', () => {
  it('is week 1 on the anchor Tuesday', () => {
    expect(completedWeek(WEEK_1_RECAP_TUESDAY, new Date('2026-09-15T12:00:00Z'))).toBe(1);
  });

  it('advances one week per 7 days', () => {
    expect(completedWeek(WEEK_1_RECAP_TUESDAY, new Date('2026-09-22T12:00:00Z'))).toBe(2);
  });

  it('is week 14 thirteen weeks after the anchor', () => {
    expect(completedWeek(WEEK_1_RECAP_TUESDAY, new Date('2026-12-15T12:00:00Z'))).toBe(14);
  });

  it('does not drop a week when the November DST change shifts the time by an hour', () => {
    expect(completedWeek(WEEK_1_RECAP_TUESDAY, new Date('2026-11-10T13:00:00Z'))).toBe(9);
  });

  it('is < 1 before the season starts', () => {
    expect(completedWeek(WEEK_1_RECAP_TUESDAY, new Date('2026-09-08T12:00:00Z'))).toBeLessThan(1);
  });
});

describe('isInSeason', () => {
  it('accepts weeks 1 through 14', () => {
    expect(isInSeason(1)).toBe(true);
    expect(isInSeason(14)).toBe(true);
  });

  it('rejects weeks outside 1–14', () => {
    expect(isInSeason(0)).toBe(false);
    expect(isInSeason(15)).toBe(false);
  });
});
