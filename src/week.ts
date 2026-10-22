export const FIRST_WEEK = 1;
export const LAST_WEEK = 14;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateAsUtcMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * The NFL week whose recap should be sent on `today`, given `anchorTuesday` (the Tuesday
 * the Week 1 recap goes out — i.e. the day after Week 1's Monday Night Football).
 *
 * Week 1 on the anchor, +1 per 7 days. Rounded so a DST hour shift can't drop a week.
 * Returns < 1 before the season starts.
 */
export function completedWeek(anchorTuesday: string, today: Date): number {
  const daysSinceAnchor = (today.getTime() - parseDateAsUtcMidnight(anchorTuesday)) / MILLISECONDS_PER_DAY;
  return Math.round(daysSinceAnchor / 7) + 1;
}

/**
 * True when `week` is within the regular season we recap (Weeks 1–14). The cron fires every
 * Tuesday year-round, so this gate is what stops sends outside the season.
 */
export function isInSeason(week: number): boolean {
  return week >= FIRST_WEEK && week <= LAST_WEEK;
}
