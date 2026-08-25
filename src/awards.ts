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
}

export interface NormalizedMatchup {
  home: NormalizedTeam;
  away: NormalizedTeam;
}

export interface WeekAwards {
  week: number;
  juggernaut: { team: string; score: number };
  corpse: { team: string; score: number };
  ballerOfTheWeek: { team: string; player: string; points: number };
  sleepwalker: { team: string; pointsLeft: number; actual: number; optimal: number };
  bonehead: {
    team: string;
    benched: string;
    benchedPoints: number;
    started: string;
    startedPoints: number;
    slot: string;
    regret: number;
  };
  backedIntoIt: { team: string; score: number; allPlayWinPct: number };
  robbed: { team: string; score: number; allPlayWinPct: number };
}

const BENCH = 'Bench';
const IR = 'IR';

const isStarter = (pl: NormalizedPlayer): boolean => pl.slot !== BENCH && pl.slot !== IR;
const startersOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter(isStarter);
const benchOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter((pl) => pl.slot === BENCH);

const allTeams = (matchups: NormalizedMatchup[]): NormalizedTeam[] =>
  matchups.flatMap((m) => [m.home, m.away]);

/**
 * Maximum total points achievable from a team's roster, filling exactly the slots the
 * manager actually started, using each player at most once and only in an eligible slot.
 * Exact solution via memoized assignment (rosters are small, so this is cheap).
 */
export function optimalLineupPoints(team: NormalizedTeam): number {
  const slots = startersOf(team).map((s) => s.slot);
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
  return { team: top.name, score: top.score };
}

function computeCorpse(teams: NormalizedTeam[]): WeekAwards['corpse'] {
  const bottom = teams.reduce((a, b) => (b.score < a.score ? b : a));
  return { team: bottom.name, score: bottom.score };
}

function computeBaller(teams: NormalizedTeam[]): WeekAwards['ballerOfTheWeek'] {
  let best: WeekAwards['ballerOfTheWeek'] | null = null;
  for (const team of teams) {
    for (const pl of startersOf(team)) {
      if (!best || pl.points > best.points) {
        best = { team: team.name, player: pl.name, points: pl.points };
      }
    }
  }
  return best!;
}

function computeSleepwalker(teams: NormalizedTeam[]): WeekAwards['sleepwalker'] {
  let best: WeekAwards['sleepwalker'] | null = null;
  for (const team of teams) {
    const actual = startersOf(team).reduce((sum, pl) => sum + pl.points, 0);
    const optimal = optimalLineupPoints(team);
    const pointsLeft = optimal - actual;
    if (!best || pointsLeft > best.pointsLeft) {
      best = { team: team.name, pointsLeft, actual, optimal };
    }
  }
  return best!;
}

function computeBonehead(teams: NormalizedTeam[]): WeekAwards['bonehead'] {
  let best: WeekAwards['bonehead'] | null = null;
  for (const team of teams) {
    for (const starter of startersOf(team)) {
      for (const benched of benchOf(team)) {
        if (!benched.eligibleSlots.includes(starter.slot)) continue;
        const regret = benched.points - starter.points;
        if (regret <= 0) continue;
        if (!best || regret > best.regret) {
          best = {
            team: team.name,
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
    best ?? {
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

/** All-play win % = share of the other teams this team would have beaten head-to-head this week. */
function allPlayWinPct(team: NormalizedTeam, teams: NormalizedTeam[]): number {
  const others = teams.filter((t) => t.teamId !== team.teamId);
  if (others.length === 0) return 0;
  let wins = 0;
  for (const other of others) {
    if (team.score > other.score) wins += 1;
    else if (team.score === other.score) wins += 0.5;
  }
  return wins / others.length;
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

  const withPct = (t: NormalizedTeam) => ({
    team: t.name,
    score: t.score,
    allPlayWinPct: allPlayWinPct(t, teams),
  });

  // Luckiest win: matchup winner with the LOWEST all-play %.
  const backedIntoIt = winners
    .map(withPct)
    .reduce((a, b) => (b.allPlayWinPct < a.allPlayWinPct ? b : a));

  // Unluckiest loss: matchup loser with the HIGHEST all-play %.
  const robbed = losers
    .map(withPct)
    .reduce((a, b) => (b.allPlayWinPct > a.allPlayWinPct ? b : a));

  return { backedIntoIt, robbed };
}

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
