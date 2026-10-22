import { computeAwards, type NormalizedMatchup } from './awards.js';

/**
 * The team awards tallied over the season. Baller of the Week is left out: it's about one
 * player's big game, not something a team keeps winning.
 */
export const SEASON_AWARD_KEYS = [
  'juggernaut',
  'corpse',
  'sleepwalker',
  'bonehead',
  'backedIntoIt',
  'robbed',
] as const;

export type SeasonAwardKey = (typeof SEASON_AWARD_KEYS)[number];

/**
 * Wins an award needs before it has a season leader, since early on one win each is just noise.
 * The Juggernaut always shows, even as a tie at one win.
 */
export const MIN_WINS_TO_LEAD: Record<SeasonAwardKey, number> = {
  juggernaut: 1,
  corpse: 2,
  sleepwalker: 2,
  bonehead: 2,
  backedIntoIt: 2,
  robbed: 2,
};

export interface WeekMatchups {
  week: number;
  matchups: NormalizedMatchup[];
}

export interface SeasonLeaderboard {
  weeks: number[];
  leaders: Record<SeasonAwardKey, { teams: string[]; count: number } | null>;
  counts: Record<SeasonAwardKey, Map<number, number>>;
  nameById: Map<number, string>;
}

/**
 * The weeks a leaderboard covers, e.g. "Weeks 1–5", "Week 1", or "Weeks 1–5, skipping 3"
 * when a week had no scores and wasn't counted.
 */
export function describeWeeks(weeks: number[]): string {
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  if (first === last) return `Week ${first}`;
  const skipped: number[] = [];
  for (let w = first; w <= last; w++) if (!weeks.includes(w)) skipped.push(w);
  const range = `Weeks ${first}–${last}`;
  return skipped.length ? `${range}, skipping ${skipped.join(', ')}` : range;
}

const hasAnyScore = (week: WeekMatchups): boolean =>
  week.matchups.some((m) => m.home.score !== 0 || m.away.score !== 0);

/**
 * The season-to-date leaderboard ("Hall of Shame"): recomputes every week's awards and tallies
 * them. There's no storage in CI, so the caller re-fetches Weeks 1..N from ESPN on each run and
 * passes them all in, in any order. Weeks with no scores are left out, and it returns undefined
 * when none has scores yet. Wins are counted by teamId and shown under each team's name from the
 * latest week it appears in. An award's leader lists every tied team, and is null until someone
 * reaches MIN_WINS_TO_LEAD.
 */
export function buildLeaderboard(weeks: WeekMatchups[]): SeasonLeaderboard | undefined {
  const played = weeks
    .filter(hasAnyScore)
    .sort((a, b) => a.week - b.week);
  if (played.length === 0) return undefined;

  const counts = Object.fromEntries(SEASON_AWARD_KEYS.map((k) => [k, new Map<number, number>()])) as Record<
    SeasonAwardKey,
    Map<number, number>
  >;
  const nameById = new Map<number, string>();

  for (const { week, matchups } of played) {
    for (const team of matchups.flatMap((m) => [m.home, m.away])) {
      nameById.set(team.teamId, team.name);
    }
    const awards = computeAwards(matchups, week);
    for (const key of SEASON_AWARD_KEYS) {
      const teamId = awards[key].teamId;
      if (teamId === undefined) continue;
      counts[key].set(teamId, (counts[key].get(teamId) ?? 0) + 1);
    }
  }

  const nameOf = (teamId: number) => nameById.get(teamId) ?? `Team ${teamId}`;

  const leaders = Object.fromEntries(
    SEASON_AWARD_KEYS.map((key) => {
      const tally = counts[key];
      const count = Math.max(0, ...tally.values());
      if (count < MIN_WINS_TO_LEAD[key]) return [key, null];
      const teams = [...tally]
        .filter(([, c]) => c === count)
        .map(([id]) => nameOf(id))
        .sort((a, b) => a.localeCompare(b));
      return [key, { teams, count }];
    }),
  ) as SeasonLeaderboard['leaders'];

  return {
    weeks: played.map((w) => w.week),
    leaders,
    counts,
    nameById,
  };
}
