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

/** Fetch and normalize a single week of the league. */
export async function fetchWeek(cfg: EspnConfig, week: number): Promise<WeekData> {
  const client = new Client({ leagueId: cfg.leagueId });
  if (shouldSetCookies(cfg)) {
    client.setCookies({ espnS2: cfg.espnS2!, SWID: cfg.swid! });
  }

  const [boxscores, teams, league] = await Promise.all([
    // For Weeks 1–14 the matchup period and scoring period both equal the NFL week.
    client.getBoxscoreForWeek({ seasonId: cfg.seasonYear, matchupPeriodId: week, scoringPeriodId: week }),
    client.getTeamsAtWeek({ seasonId: cfg.seasonYear, scoringPeriodId: week }),
    // Lineup settings let awards count slots a manager left empty. Not essential: without
    // them the awards fall back to the slots each manager actually started.
    client.getLeagueInfo({ seasonId: cfg.seasonYear }).catch((err: unknown) => {
      console.warn(`Could not load league lineup settings; using started slots instead. (${String(err)})`);
      return undefined;
    }),
  ]);
  const lineupSlots = lineupSlotsFromCounts(league?.rosterSettings?.lineupPositionCount);

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
