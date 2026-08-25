/**
 * Season-week math + the Weeks 1–14 gate.
 *
 * The cron fires every Tuesday year-round; the script self-limits by computing which NFL
 * week just completed from a fixed anchor date and refusing to send outside Weeks 1–14.
 */

export const FIRST_WEEK = 1;
export const LAST_WEEK = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parse a 'YYYY-MM-DD' date as UTC midnight (avoids local-timezone drift). */
function utcMidnight(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

/**
 * The NFL week whose recap should be sent on `today`, given `anchorTuesday` (the Tuesday
 * the Week 1 recap goes out — i.e. the day after Week 1's Monday Night Football).
 *
 * Week 1 on the anchor, +1 per 7 days. Rounded so a DST hour shift can't drop a week.
 * Returns < 1 before the season starts.
 */
export function completedWeek(anchorTuesday: string, today: Date): number {
  const diffDays = (today.getTime() - utcMidnight(anchorTuesday)) / MS_PER_DAY;
  return Math.round(diffDays / 7) + 1;
}

/** True when `week` is within the regular season we recap (Weeks 1–14). */
export function isInSeason(week: number): boolean {
  return week >= FIRST_WEEK && week <= LAST_WEEK;
}
