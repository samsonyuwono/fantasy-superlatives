/**
 * Pure superlative-award logic. No I/O — operates on normalized objects so it is
 * fully unit-testable without live ESPN calls. `espn.ts` produces these shapes.
 */

export interface NormalizedPlayer {
  /** Player display name. */
  name: string;
  /** Fantasy points scored this week. */
  points: number;
  /** Lineup slot the player occupied, e.g. 'QB', 'RB', 'WR', 'TE', 'FLEX', 'D/ST', 'K', 'Bench', 'IR'. */
  slot: string;
  /** Lineup slot labels this player is eligible to fill (includes 'FLEX' for RB/WR/TE, etc.). */
  eligibleSlots: string[];
}

export interface NormalizedTeam {
  teamId: number;
  name: string;
  /** Actual points scored (from ESPN). */
  score: number;
  players: NormalizedPlayer[];
  lineupSlots?: string[];
}

export interface NormalizedMatchup {
  home: NormalizedTeam;
  away: NormalizedTeam;
}

/** How a team's score would have done against every other team this week. */
export interface AllPlayRecord {
  beaten: number;
  tied: number;
  /** Number of other teams in the league. */
  opponents: number;
}

/**
 * Season tallies count awards by `teamId`, not name, because managers rename their teams
 * mid-season. It's optional only where an award can be an empty placeholder (no Bonehead
 * swap, no decided matchups).
 */
export interface WeekAwards {
  week: number;
  juggernaut: { team: string; teamId: number; score: number };
  corpse: { team: string; teamId: number; score: number };
  ballerOfTheWeek: { team: string; player: string; points: number };
  sleepwalker: { team: string; teamId: number; pointsLeft: number; actual: number; optimal: number };
  bonehead: {
    team: string;
    teamId?: number;
    benched: string;
    benchedPoints: number;
    started: string;
    startedPoints: number;
    slot: string;
    regret: number;
  };
  backedIntoIt: { team: string; teamId?: number; score: number; allPlayWinPct: number; allPlay: AllPlayRecord };
  robbed: { team: string; teamId?: number; score: number; allPlayWinPct: number; allPlay: AllPlayRecord };
}

const BENCH = 'Bench';
const IR = 'IR';

const isStarter = (pl: NormalizedPlayer): boolean => pl.slot !== BENCH && pl.slot !== IR;
const startersOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter(isStarter);
const benchOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter((pl) => pl.slot === BENCH);

const allTeams = (matchups: NormalizedMatchup[]): NormalizedTeam[] =>
  matchups.flatMap((m) => [m.home, m.away]);

/**
 * Maximum total points achievable from a team's roster, filling the league's lineup slots
 * (or, if unknown, the slots the manager actually started), using each player at most once
 * and only in an eligible slot.
 * Exact solution via memoized assignment (rosters are small, so this is cheap).
 */
export function optimalLineupPoints(team: NormalizedTeam): number {
  const slots = team.lineupSlots ?? startersOf(team).map((s) => s.slot);
  // Pool of candidates: everyone who could have been started (starters + bench, never IR).
  const pool = team.players.filter((pl) => pl.slot !== IR);
  const memo = new Map<string, number>();

  const solve = (slotIndex: number, usedMask: number): number => {
    if (slotIndex === slots.length) return 0;
    const key = `${slotIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const slot = slots[slotIndex]!;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const bit = 1 << i;
      if (usedMask & bit) continue;
      const candidate = pool[i]!;
      if (!candidate.eligibleSlots.includes(slot)) continue;
      const total = candidate.points + solve(slotIndex + 1, usedMask | bit);
      if (total > best) best = total;
    }
    // If no eligible player is free for this slot, treat as unfillable (0 for this slot).
    if (best === -Infinity) best = solve(slotIndex + 1, usedMask);
    memo.set(key, best);
    return best;
  };

  return solve(0, 0);
}

function computeJuggernaut(teams: NormalizedTeam[]): WeekAwards['juggernaut'] {
  const top = teams.reduce((a, b) => (b.score > a.score ? b : a));
  return { team: top.name, teamId: top.teamId, score: top.score };
}

function computeCorpse(teams: NormalizedTeam[]): WeekAwards['corpse'] {
  const bottom = teams.reduce((a, b) => (b.score < a.score ? b : a));
  return { team: bottom.name, teamId: bottom.teamId, score: bottom.score };
}

function computeBaller(teams: NormalizedTeam[]): WeekAwards['ballerOfTheWeek'] {
  let topStarter: WeekAwards['ballerOfTheWeek'] | null = null;
  for (const team of teams) {
    for (const pl of startersOf(team)) {
      if (!topStarter || pl.points > topStarter.points) {
        topStarter = { team: team.name, player: pl.name, points: pl.points };
      }
    }
  }
  return topStarter!;
}

function computeSleepwalker(teams: NormalizedTeam[]): WeekAwards['sleepwalker'] {
  let mostPointsLeft: WeekAwards['sleepwalker'] | null = null;
  for (const team of teams) {
    const actual = startersOf(team).reduce((sum, pl) => sum + pl.points, 0);
    const optimal = optimalLineupPoints(team);
    const pointsLeft = optimal - actual;
    if (!mostPointsLeft || pointsLeft > mostPointsLeft.pointsLeft) {
      mostPointsLeft = { team: team.name, teamId: team.teamId, pointsLeft, actual, optimal };
    }
  }
  return mostPointsLeft!;
}

function computeBonehead(teams: NormalizedTeam[]): WeekAwards['bonehead'] {
  let worstSwap: WeekAwards['bonehead'] | null = null;
  for (const team of teams) {
    for (const starter of startersOf(team)) {
      for (const benched of benchOf(team)) {
        if (!benched.eligibleSlots.includes(starter.slot)) continue;
        const regret = benched.points - starter.points;
        if (regret <= 0) continue;
        if (!worstSwap || regret > worstSwap.regret) {
          worstSwap = {
            team: team.name,
            teamId: team.teamId,
            benched: benched.name,
            benchedPoints: benched.points,
            started: starter.name,
            startedPoints: starter.points,
            slot: starter.slot,
            regret,
          };
        }
      }
    }
  }
  // No legal beneficial swap anywhere: report a null-ish "nobody blundered" result.
  return (
    worstSwap ?? {
      team: '',
      benched: '',
      benchedPoints: 0,
      started: '',
      startedPoints: 0,
      slot: '',
      regret: 0,
    }
  );
}

function allPlayRecord(team: NormalizedTeam, teams: NormalizedTeam[]): AllPlayRecord {
  const others = teams.filter((t) => t.teamId !== team.teamId);
  return {
    beaten: others.filter((o) => team.score > o.score).length,
    tied: others.filter((o) => team.score === o.score).length,
    opponents: others.length,
  };
}

/** All-play win % = share of the other teams this team would have beaten head-to-head this week (ties count half). */
function allPlayWinPct(r: AllPlayRecord): number {
  return r.opponents === 0 ? 0 : (r.beaten + r.tied / 2) / r.opponents;
}

function computeLuck(
  matchups: NormalizedMatchup[],
  teams: NormalizedTeam[],
): { backedIntoIt: WeekAwards['backedIntoIt']; robbed: WeekAwards['robbed'] } {
  const winners: NormalizedTeam[] = [];
  const losers: NormalizedTeam[] = [];
  for (const m of matchups) {
    if (m.home.score > m.away.score) {
      winners.push(m.home);
      losers.push(m.away);
    } else if (m.away.score > m.home.score) {
      winners.push(m.away);
      losers.push(m.home);
    }
    // exact ties contribute no winner/loser
  }

  const withPct = (t: NormalizedTeam) => {
    const allPlay = allPlayRecord(t, teams);
    return { team: t.name, teamId: t.teamId, score: t.score, allPlayWinPct: allPlayWinPct(allPlay), allPlay };
  };

  // No decided matchups (e.g. every team scored 0 because the week hasn't been played):
  // there is no luck to award, so return placeholders instead of reducing an empty array.
  const emptyLuck = { team: '', score: 0, allPlayWinPct: 0, allPlay: { beaten: 0, tied: 0, opponents: 0 } };

  // Luckiest win: matchup winner with the LOWEST all-play %.
  const backedIntoIt = winners.length
    ? winners.map(withPct).reduce((a, b) => (b.allPlayWinPct < a.allPlayWinPct ? b : a))
    : emptyLuck;

  // Unluckiest loss: matchup loser with the HIGHEST all-play %.
  const robbed = losers.length
    ? losers.map(withPct).reduce((a, b) => (b.allPlayWinPct > a.allPlayWinPct ? b : a))
    : emptyLuck;

  return { backedIntoIt, robbed };
}

/** Compute all seven awards for one week from its normalized matchups. */
export function computeAwards(matchups: NormalizedMatchup[], week: number): WeekAwards {
  const teams = allTeams(matchups);
  const { backedIntoIt, robbed } = computeLuck(matchups, teams);
  return {
    week,
    juggernaut: computeJuggernaut(teams),
    corpse: computeCorpse(teams),
    ballerOfTheWeek: computeBaller(teams),
    sleepwalker: computeSleepwalker(teams),
    bonehead: computeBonehead(teams),
    backedIntoIt,
    robbed,
  };
}
