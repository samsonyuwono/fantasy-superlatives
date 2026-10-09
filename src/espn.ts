/**
 * ESPN adapter: fetch one week's box scores + team records and normalize them into the
 * plain shapes that `awards.ts` consumes. This is the only module that talks to ESPN.
 */
import espn from 'espn-fantasy-football-api/node';
import type { NormalizedMatchup, NormalizedPlayer, NormalizedTeam } from './awards.js';

interface RawPlayer {
  fullName?: string;
  totalPoints?: number;
  rosteredPosition?: string;
  eligiblePositions?: string[];
}

interface RawBoxscore {
  homeTeamId?: number;
  awayTeamId?: number;
  homeScore?: number;
  awayScore?: number;
  homeRoster?: RawPlayer[];
  awayRoster?: RawPlayer[];
}

export interface RawTeam {
  id?: number;
  name?: string;
  abbreviation?: string;
}

interface RawLeagueInfo {
  rosterSettings?: { lineupPositionCount?: Record<string, number> };
}

const { Client } = espn as unknown as { Client: new (opts: { leagueId: number }) => EspnClient };

interface EspnClient {
  setCookies(cookies: { espnS2: string; SWID: string }): void;
  getBoxscoreForWeek(opts: { seasonId: number; matchupPeriodId: number; scoringPeriodId: number }): Promise<RawBoxscore[]>;
  getTeamsAtWeek(opts: { seasonId: number; scoringPeriodId: number }): Promise<RawTeam[]>;
  getLeagueInfo(opts: { seasonId: number }): Promise<RawLeagueInfo | undefined>;
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
export function teamName(team: RawTeam | undefined): string {
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

function normalizePlayer(bp: RawPlayer | undefined): NormalizedPlayer {
  return {
    name: bp?.fullName ?? 'Unknown Player',
    points: typeof bp?.totalPoints === 'number' ? bp.totalPoints : 0,
    slot: bp?.rosteredPosition ?? 'Bench',
    eligibleSlots: Array.isArray(bp?.eligiblePositions) ? bp.eligiblePositions : [],
  };
}

function normalizeTeam(
  teamId: number,
  score: number | undefined,
  roster: RawPlayer[] | undefined,
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
  for (const t of teams) {
    if (typeof t?.id === 'number') nameById.set(t.id, teamName(t));
  }

  const matchups: NormalizedMatchup[] = boxscores
    .filter((b): b is RawBoxscore & { homeTeamId: number; awayTeamId: number } =>
      b?.homeTeamId != null && b?.awayTeamId != null,
    )
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

/**
 * How an ESPN access check failed: ESPN answered with an HTTP error, couldn't be reached at all,
 * or answered with something other than the league's settings.
 */
export type EspnFailure = 'rejected' | 'unreachable' | 'unreadable';

/** A failed ESPN access check. `status` is ESPN's HTTP status, when it sent one. */
export class EspnAccessError extends Error {
  constructor(
    message: string,
    readonly failure: EspnFailure,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EspnAccessError';
  }

  /** ESPN answers 401 or 403 when it rejects the cookies, e.g. because they expired. */
  static isAuthStatus(status: number | undefined): boolean {
    return status === 401 || status === 403;
  }

  get isAuthFailure(): boolean {
    return EspnAccessError.isAuthStatus(this.status);
  }
}

/** The HTTP status on a failed request from the library (an axios error carries it on `response`). */
export function httpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('response' in err)) return undefined;
  const { response } = err;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

/** True for an axios request error, as opposed to the library failing to read a response. */
function isRequestError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'isAxiosError' in err && err.isAxiosError === true;
}

/**
 * Confirm ESPN will serve this league's settings with the configured cookies. Throws an
 * EspnAccessError saying whether ESPN rejected the request, couldn't be reached, or sent
 * something other than the settings.
 */
export async function checkLeagueAccess(cfg: EspnConfig): Promise<void> {
  const where = `league ${cfg.leagueId} (season ${cfg.seasonYear})`;
  let league: RawLeagueInfo | undefined;
  try {
    league = await makeClient(cfg).getLeagueInfo({ seasonId: cfg.seasonYear });
  } catch (err) {
    const status = httpStatus(err);
    const detail = err instanceof Error ? err.message : String(err);
    if (status !== undefined) {
      const hint = EspnAccessError.isAuthStatus(status) ? ' The espn_s2/SWID cookies may have expired.' : '';
      throw new EspnAccessError(`ESPN rejected the request for ${where}: ${detail}.${hint}`, 'rejected', status);
    }
    if (isRequestError(err)) {
      throw new EspnAccessError(`Could not reach ESPN for ${where}: ${detail}.`, 'unreachable');
    }
    throw new EspnAccessError(`ESPN sent a response for ${where} that could not be read: ${detail}.`, 'unreadable');
  }
  if (!league?.rosterSettings) {
    throw new EspnAccessError(`ESPN returned no settings for ${where}.`, 'unreadable');
  }
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
