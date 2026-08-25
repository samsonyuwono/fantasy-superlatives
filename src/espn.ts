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
}

export interface EspnConfig {
  leagueId: number;
  seasonYear: number;
  espnS2: string;
  swid: string;
}

export interface StandingRow {
  name: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface WeekData {
  matchups: NormalizedMatchup[];
  standings: StandingRow[];
}

export function teamName(team: any): string {
  const name = typeof team?.name === 'string' ? team.name.replace(/\s+/g, ' ').trim() : '';
  return name || team?.abbreviation || `Team ${team?.id ?? '?'}`;
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
): NormalizedTeam {
  return {
    teamId,
    name: nameById.get(teamId) ?? `Team ${teamId}`,
    score: typeof score === 'number' ? score : 0,
    players: (roster ?? []).map(normalizePlayer),
  };
}

/** Fetch and normalize a single week of the league. */
export async function fetchWeek(cfg: EspnConfig, week: number): Promise<WeekData> {
  const client = new Client({ leagueId: cfg.leagueId });
  client.setCookies({ espnS2: cfg.espnS2, SWID: cfg.swid });

  const [boxscores, teams] = await Promise.all([
    // For Weeks 1–14 the matchup period and scoring period both equal the NFL week.
    client.getBoxscoreForWeek({ seasonId: cfg.seasonYear, matchupPeriodId: week, scoringPeriodId: week }),
    client.getTeamsAtWeek({ seasonId: cfg.seasonYear, scoringPeriodId: week }),
  ]);

  const nameById = new Map<number, string>();
  for (const t of teams) nameById.set(t.id, teamName(t));

  const matchups: NormalizedMatchup[] = boxscores
    // Drop any bye/placeholder rows that lack two real teams.
    .filter((b) => b?.homeTeamId != null && b?.awayTeamId != null)
    .map((b) => ({
      home: normalizeTeam(b.homeTeamId, b.homeScore, b.homeRoster, nameById),
      away: normalizeTeam(b.awayTeamId, b.awayScore, b.awayRoster, nameById),
    }));

  const standings: StandingRow[] = teams
    .map((t) => ({
      name: teamName(t),
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      ties: t.ties ?? 0,
      pointsFor: t.regularSeasonPointsFor ?? t.totalPointsScored ?? 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);

  return { matchups, standings };
}
