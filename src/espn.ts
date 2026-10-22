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

const { Client } = espn as unknown as { Client: new (options: { leagueId: number }) => EspnClient };

interface EspnClient {
  setCookies(cookies: { espnS2: string; SWID: string }): void;
  getBoxscoreForWeek(options: { seasonId: number; matchupPeriodId: number; scoringPeriodId: number }): Promise<RawBoxscore[]>;
  getTeamsAtWeek(options: { seasonId: number; scoringPeriodId: number }): Promise<RawTeam[]>;
  getLeagueInfo(options: { seasonId: number }): Promise<RawLeagueInfo | undefined>;
}

export interface EspnConfig {
  leagueId: number;
  seasonYear: number;
  espnS2?: string;
  swid?: string;
}

/**
 * Public leagues need no ESPN login, so their config omits both `espnS2` and `swid`.
 * Only set cookies when both are present.
 */
export function shouldSetCookies(config: EspnConfig): boolean {
  return Boolean(config.espnS2 && config.swid);
}

export interface WeekData {
  matchups: NormalizedMatchup[];
}

/** A team's display name with whitespace tidied, falling back to its abbreviation, then "Team <id>". */
export function teamName(team: RawTeam): string {
  const name = typeof team.name === 'string' ? team.name.replace(/\s+/g, ' ').trim() : '';
  return name || team.abbreviation || `Team ${team.id ?? '?'}`;
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

function normalizePlayer(rawPlayer: RawPlayer): NormalizedPlayer {
  return {
    name: rawPlayer.fullName ?? 'Unknown Player',
    points: typeof rawPlayer.totalPoints === 'number' ? rawPlayer.totalPoints : 0,
    slot: rawPlayer.rosteredPosition ?? 'Bench',
    eligibleSlots: Array.isArray(rawPlayer.eligiblePositions) ? rawPlayer.eligiblePositions : [],
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

function makeClient(config: EspnConfig): EspnClient {
  const client = new Client({ leagueId: config.leagueId });
  if (shouldSetCookies(config)) {
    client.setCookies({ espnS2: config.espnS2!, SWID: config.swid! });
  }
  return client;
}

async function fetchLineupSlots(client: EspnClient, config: EspnConfig): Promise<string[] | undefined> {
  const league = await client.getLeagueInfo({ seasonId: config.seasonYear }).catch((error: unknown) => {
    console.warn(`Could not load league lineup settings; using started slots instead. (${String(error)})`);
    return undefined;
  });
  return lineupSlotsFromCounts(league?.rosterSettings?.lineupPositionCount);
}

async function fetchWeekWith(
  client: EspnClient,
  config: EspnConfig,
  week: number,
  lineupSlotsPromise: Promise<string[] | undefined>,
  withNames: boolean,
): Promise<WeekData> {
  const [boxScores, teams, lineupSlots] = await Promise.all([
    client.getBoxscoreForWeek({ seasonId: config.seasonYear, matchupPeriodId: week, scoringPeriodId: week }),
    withNames ? client.getTeamsAtWeek({ seasonId: config.seasonYear, scoringPeriodId: week }) : [],
    lineupSlotsPromise,
  ]);

  const nameById = new Map<number, string>();
  for (const team of teams) {
    if (typeof team.id === 'number') nameById.set(team.id, teamName(team));
  }

  const matchups: NormalizedMatchup[] = boxScores
    .filter((boxScore): boxScore is RawBoxscore & { homeTeamId: number; awayTeamId: number } =>
      boxScore?.homeTeamId != null && boxScore?.awayTeamId != null,
    )
    .map((boxScore) => ({
      home: normalizeTeam(boxScore.homeTeamId, boxScore.homeScore, boxScore.homeRoster, nameById, lineupSlots),
      away: normalizeTeam(boxScore.awayTeamId, boxScore.awayScore, boxScore.awayRoster, nameById, lineupSlots),
    }));

  return { matchups };
}

const EARLIER_WEEKS_FETCHED_AT_ONCE = 6;
const RETRY_DELAY_MILLISECONDS = 1000;

/** Run `operation`, and if it fails, wait and try once more. */
export async function withRetry<T>(
  operation: () => Promise<T>,
  retryDelayMilliseconds = RETRY_DELAY_MILLISECONDS,
): Promise<T> {
  try {
    return await operation();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds));
    return operation();
  }
}

/** Map over `items` with at most `batchSize` calls running at a time, keeping the input order. */
export async function mapInBatches<T, R>(items: T[], batchSize: number, mapItem: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    results.push(...(await Promise.all(items.slice(i, i + batchSize).map(mapItem))));
  }
  return results;
}

export type EspnFailure = 'rejected' | 'unreachable' | 'unreadable';

export class EspnAccessError extends Error {
  constructor(
    message: string,
    readonly failure: EspnFailure,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'EspnAccessError';
  }

  static isAuthStatus(status: number | undefined): boolean {
    return status === 401 || status === 403;
  }

  get isAuthFailure(): boolean {
    return EspnAccessError.isAuthStatus(this.status);
  }
}

/** The HTTP status on a failed request from the library (an axios error carries it on `response`). */
export function httpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('response' in error)) return undefined;
  const { response } = error;
  if (typeof response !== 'object' || response === null || !('status' in response)) return undefined;
  return typeof response.status === 'number' ? response.status : undefined;
}

function isAxiosRequestError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'isAxiosError' in error && error.isAxiosError === true;
}

/**
 * Confirm ESPN will serve this league's settings with the configured cookies. Throws an
 * EspnAccessError whose `failure` is 'rejected' (ESPN answered with an HTTP error, kept in
 * `status`; 401/403 means the cookies were refused, e.g. expired), 'unreachable' (the request
 * never got an answer), or 'unreadable' (ESPN answered with something other than the settings).
 */
export async function checkLeagueAccess(config: EspnConfig): Promise<void> {
  const leagueAndSeason = `league ${config.leagueId} (season ${config.seasonYear})`;
  let league: RawLeagueInfo | undefined;
  try {
    league = await makeClient(config).getLeagueInfo({ seasonId: config.seasonYear });
  } catch (error) {
    const status = httpStatus(error);
    const detail = error instanceof Error ? error.message : String(error);
    if (status !== undefined) {
      const hint = EspnAccessError.isAuthStatus(status) ? ' The espn_s2/SWID cookies may have expired.' : '';
      throw new EspnAccessError(`ESPN rejected the request for ${leagueAndSeason}: ${detail}.${hint}`, 'rejected', status);
    }
    if (isAxiosRequestError(error)) {
      throw new EspnAccessError(`Could not reach ESPN for ${leagueAndSeason}: ${detail}.`, 'unreachable');
    }
    throw new EspnAccessError(`ESPN sent a response for ${leagueAndSeason} that could not be read: ${detail}.`, 'unreadable');
  }
  if (!league?.rosterSettings) {
    throw new EspnAccessError(`ESPN returned no settings for ${leagueAndSeason}.`, 'unreadable');
  }
}

export interface LeagueFetcher {
  week(week: number): Promise<WeekData>;
  earlierWeeks(weeks: number[]): Promise<(WeekData & { week: number })[]>;
}

/**
 * One ESPN client and one lineup-settings lookup, shared by every week fetched for a league.
 * `week` includes team names; `earlierWeeks` skips them so each week is a single request, and
 * fetches a few weeks at a time so a late-season tally isn't one big burst of requests.
 * The lineup settings let awards count slots a manager left empty; if they can't be loaded,
 * the awards fall back to the slots each manager actually started.
 */
export function leagueFetcher(config: EspnConfig): LeagueFetcher {
  const client = makeClient(config);
  const lineupSlots = fetchLineupSlots(client, config);
  return {
    week: (week) => fetchWeekWith(client, config, week, lineupSlots, true),
    earlierWeeks: (weeks) =>
      mapInBatches(weeks, EARLIER_WEEKS_FETCHED_AT_ONCE, async (week) => ({
        week,
        ...(await withRetry(() => fetchWeekWith(client, config, week, lineupSlots, false))),
      })),
  };
}
