/**
 * ESPN adapter: fetch one week's box scores + team records and normalize them into the
 * plain shapes that `awards.ts` consumes. This is the only module that talks to ESPN.
 */
import espn from 'espn-fantasy-football-api/node';
import type { NormalizedMatchup, NormalizedPlayer, NormalizedTeam } from './awards.js';

// The library is CommonJS and untyped for our purposes; treat its objects as `any`.
const { Client } = espn as unknown as { Client: new (opts: { leagueId: number }) => EspnClient };

interface EspnClient {
  setCookies(cookies: { espnS2: string; SWID: string }): void;
  getBoxscoreForWeek(opts: { seasonId: number; matchupPeriodId: number; scoringPeriodId: number }): Promise<any[]>;
  getTeamsAtWeek(opts: { seasonId: number; scoringPeriodId: number }): Promise<any[]>;
  getLeagueInfo(opts: { seasonId: number }): Promise<any>;
}

export interface EspnConfig {
  leagueId: number;
  seasonYear: number;
  /** Omit both for a public league — no ESPN login is needed to read it. */
  espnS2?: string;
  swid?: string;
}

/** Public leagues need no cookies at all; only set them when both are present. */
export function shouldSetCookies(cfg: EspnConfig): boolean {
  return Boolean(cfg.espnS2 && cfg.swid);
}

export interface WeekData {
  matchups: NormalizedMatchup[];
}

/** A team's display name with whitespace tidied, falling back to its abbreviation, then "Team <id>". */
export function teamName(team: any): string {
  const name = typeof team?.name === 'string' ? team.name.replace(/\s+/g, ' ').trim() : '';
  return name || team?.abbreviation || `Team ${team?.id ?? '?'}`;
}

/**
 * Turn ESPN's lineup slot counts (e.g. { QB: 1, 'RB/WR/TE': 2, Bench: 7 }) into one entry
 * per starting slot. Returns undefined when there are no starting slots to read.
 */
export function lineupSlotsFromCounts(counts: Record<string, number> | undefined): string[] | undefined {
  const slots = Object.entries(counts ?? {})
    .filter(([slot]) => slot !== 'Bench' && slot !== 'IR')
    .flatMap(([slot, count]) => Array<string>(Math.max(0, count || 0)).fill(slot));
  return slots.length ? slots : undefined;
}

function normalizePlayer(bp: any): NormalizedPlayer {
  return {
    name: bp?.fullName ?? 'Unknown Player',
    points: typeof bp?.totalPoints === 'number' ? bp.totalPoints : 0,
    slot: bp?.rosteredPosition ?? 'Bench',
    eligibleSlots: Array.isArray(bp?.eligiblePositions) ? bp.eligiblePositions : [],
  };
}

function normalizeTeam(
  teamId: number,
  score: number,
  roster: any[],
  nameById: Map<number, string>,
  lineupSlots: string[] | undefined,
): NormalizedTeam {
  return {
    teamId,
    name: nameById.get(teamId) ?? `Team ${teamId}`,
    score: typeof score === 'number' ? score : 0,
    players: (roster ?? []).map(normalizePlayer),
    lineupSlots,
  };
}

function makeClient(cfg: EspnConfig): EspnClient {
  const client = new Client({ leagueId: cfg.leagueId });
  if (shouldSetCookies(cfg)) {
    client.setCookies({ espnS2: cfg.espnS2!, SWID: cfg.swid! });
  }
  return client;
}

/**
 * Lineup settings let awards count slots a manager left empty. Not essential: without
 * them the awards fall back to the slots each manager actually started.
 */
async function fetchLineupSlots(client: EspnClient, cfg: EspnConfig): Promise<string[] | undefined> {
  const league = await client.getLeagueInfo({ seasonId: cfg.seasonYear }).catch((err: unknown) => {
    console.warn(`Could not load league lineup settings; using started slots instead. (${String(err)})`);
    return undefined;
  });
  return lineupSlotsFromCounts(league?.rosterSettings?.lineupPositionCount);
}

async function fetchWeekWith(
  client: EspnClient,
  cfg: EspnConfig,
  week: number,
  lineupSlotsPromise: Promise<string[] | undefined>,
  withNames: boolean,
): Promise<WeekData> {
  const [boxscores, teams, lineupSlots] = await Promise.all([
    client.getBoxscoreForWeek({ seasonId: cfg.seasonYear, matchupPeriodId: week, scoringPeriodId: week }),
    withNames ? client.getTeamsAtWeek({ seasonId: cfg.seasonYear, scoringPeriodId: week }) : [],
    lineupSlotsPromise,
  ]);

  const nameById = new Map<number, string>();
  for (const t of teams) nameById.set(t.id, teamName(t));

  const matchups: NormalizedMatchup[] = boxscores
    // Drop any bye/placeholder rows that lack two real teams.
    .filter((b) => b?.homeTeamId != null && b?.awayTeamId != null)
    .map((b) => ({
      home: normalizeTeam(b.homeTeamId, b.homeScore, b.homeRoster, nameById, lineupSlots),
      away: normalizeTeam(b.awayTeamId, b.awayScore, b.awayRoster, nameById, lineupSlots),
    }));

  return { matchups };
}

/**
 * How many earlier weeks to fetch from ESPN at once, so a late-season tally isn't one big burst
 * of requests. Each one is a single request, since earlier weeks skip the team names.
 */
const WEEKS_AT_ONCE = 6;
const RETRY_DELAY_MS = 1000;

/** Run `fn`, and if it fails, wait and try once more. */
export async function withRetry<T>(fn: () => Promise<T>, retryDelayMs = RETRY_DELAY_MS): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return fn();
  }
}

/** Map over `items` with at most `size` calls running at a time, keeping the input order. */
export async function mapInBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}

export interface LeagueFetcher {
  /** Fetch and normalize one week, with team names. */
  week(week: number): Promise<WeekData>;
  earlierWeeks(weeks: number[]): Promise<(WeekData & { week: number })[]>;
}

/** One ESPN client and one lineup-settings lookup, shared by every week fetched for a league. */
export function leagueFetcher(cfg: EspnConfig): LeagueFetcher {
  const client = makeClient(cfg);
  const lineupSlots = fetchLineupSlots(client, cfg);
  return {
    week: (week) => fetchWeekWith(client, cfg, week, lineupSlots, true),
    earlierWeeks: (weeks) =>
      mapInBatches(weeks, WEEKS_AT_ONCE, async (week) => ({
        week,
        ...(await withRetry(() => fetchWeekWith(client, cfg, week, lineupSlots, false))),
      })),
  };
}
