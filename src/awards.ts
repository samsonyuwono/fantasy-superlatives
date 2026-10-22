export interface NormalizedPlayer {
  name: string;
  points: number;
  slot: string;
  eligibleSlots: string[];
}

export interface NormalizedTeam {
  teamId: number;
  name: string;
  score: number;
  players: NormalizedPlayer[];
  lineupSlots?: string[];
}

export interface NormalizedMatchup {
  home: NormalizedTeam;
  away: NormalizedTeam;
}

export interface AllPlayRecord {
  beaten: number;
  tied: number;
  opponents: number;
}

export interface MatchupResult {
  home: string;
  homeScore: number;
  away: string;
  awayScore: number;
}

export interface MatchupOutcome {
  result: 'won' | 'lost' | 'tied';
  score: number;
  opponent: string;
  opponentScore: number;
  flipped: boolean;
}

export interface WeekAwards {
  week: number;
  results: MatchupResult[];
  juggernaut: { team: string; teamId: number; score: number };
  corpse: { team: string; teamId: number; score: number };
  ballerOfTheWeek: { team: string; player: string; points: number };
  sleepwalker: { team: string; teamId: number; pointsLeft: number; actual: number; optimal: number; matchup: MatchupOutcome };
  bonehead: {
    team: string;
    teamId?: number;
    benched: string;
    benchedPoints: number;
    started: string;
    startedPoints: number;
    slot: string;
    regret: number;
    matchup?: MatchupOutcome;
  };
  backedIntoIt: { team: string; teamId?: number; score: number; allPlayWinPct: number; allPlay: AllPlayRecord };
  robbed: { team: string; teamId?: number; score: number; allPlayWinPct: number; allPlay: AllPlayRecord };
}

export type AwardKey = Exclude<keyof WeekAwards, 'week' | 'results'>;

export interface AwardInfo {
  name: string;
  emoji: string;
  description: string;
  requiredInRoast: boolean;
}

/**
 * Every award's name and emoji, in the order the recap lists them. Keyed by `AwardKey`, so a new
 * award in `WeekAwards` doesn't compile until it has an entry here.
 */
export const AWARDS: Record<AwardKey, AwardInfo> = {
  juggernaut: { name: 'The Juggernaut', emoji: '💪', description: 'highest team score', requiredInRoast: true },
  corpse: { name: 'The Corpse', emoji: '💀', description: 'lowest team score', requiredInRoast: true },
  ballerOfTheWeek: { name: 'Baller of the Week', emoji: '⭐', description: 'top individual starter', requiredInRoast: true },
  sleepwalker: { name: 'The Sleepwalker', emoji: '😴', description: 'most points left on the bench', requiredInRoast: true },
  bonehead: { name: 'The Bonehead', emoji: '🤡', description: 'worst start/sit', requiredInRoast: true },
  backedIntoIt: { name: 'Backed Into It', emoji: '🍀', description: 'luckiest win', requiredInRoast: true },
  robbed: { name: 'Robbed', emoji: '😤', description: 'unluckiest loss', requiredInRoast: true },
};

const BENCH = 'Bench';
const IR = 'IR';

/** How a lineup slot reads in the recap. ESPN calls the FLEX slot 'RB/WR/TE'; the league calls it Flex. */
export function slotLabel(slot: string): string {
  return slot === 'RB/WR/TE' ? 'Flex' : slot;
}

const isStarter = (pl: NormalizedPlayer): boolean => pl.slot !== BENCH && pl.slot !== IR;
const startersOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter(isStarter);
const benchOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter((pl) => pl.slot === BENCH);

const allTeams = (matchups: NormalizedMatchup[]): NormalizedTeam[] =>
  matchups.flatMap((m) => [m.home, m.away]);

/**
 * Maximum total points achievable from a team's roster, filling the league's lineup slots
 * (or, if unknown, the slots the manager actually started), using each starter or bench
 * player (never IR) at most once and only in an eligible slot. A slot no free player can
 * fill scores 0. Exact solution via memoized assignment (rosters are small, so this is cheap).
 */
export function optimalLineupPoints(team: NormalizedTeam): number {
  const slots = team.lineupSlots ?? startersOf(team).map((s) => s.slot);
  const startablePlayers = team.players.filter((pl) => pl.slot !== IR);
  const memo = new Map<string, number>();

  const solve = (slotIndex: number, usedMask: number): number => {
    if (slotIndex === slots.length) return 0;
    const key = `${slotIndex}:${usedMask}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const slot = slots[slotIndex]!;
    let best = -Infinity;
    for (let i = 0; i < startablePlayers.length; i++) {
      const bit = 1 << i;
      if (usedMask & bit) continue;
      const candidate = startablePlayers[i]!;
      if (!candidate.eligibleSlots.includes(slot)) continue;
      const total = candidate.points + solve(slotIndex + 1, usedMask | bit);
      if (total > best) best = total;
    }
    const slotUnfillable = best === -Infinity;
    if (slotUnfillable) best = solve(slotIndex + 1, usedMask);
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

type Sleepwalker = Omit<WeekAwards['sleepwalker'], 'matchup'>;

function computeSleepwalker(teams: NormalizedTeam[]): Sleepwalker {
  let mostPointsLeft: Sleepwalker | null = null;
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
  return worstSwap ?? nobodyBlundered();
}

function nobodyBlundered(): WeekAwards['bonehead'] {
  return {
    team: '',
    benched: '',
    benchedPoints: 0,
    started: '',
    startedPoints: 0,
    slot: '',
    regret: 0,
  };
}

function allPlayRecord(team: NormalizedTeam, teams: NormalizedTeam[]): AllPlayRecord {
  const others = teams.filter((t) => t.teamId !== team.teamId);
  return {
    beaten: others.filter((o) => team.score > o.score).length,
    tied: others.filter((o) => team.score === o.score).length,
    opponents: others.length,
  };
}

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
  }

  const withAllPlay = (t: NormalizedTeam) => {
    const allPlay = allPlayRecord(t, teams);
    return { team: t.name, teamId: t.teamId, score: t.score, allPlayWinPct: allPlayWinPct(allPlay), allPlay };
  };

  const noDecidedMatchupPlaceholder = {
    team: '',
    score: 0,
    allPlayWinPct: 0,
    allPlay: { beaten: 0, tied: 0, opponents: 0 },
  };

  const luckiestWinner = winners.length
    ? winners.map(withAllPlay).reduce((a, b) => (b.allPlayWinPct < a.allPlayWinPct ? b : a))
    : noDecidedMatchupPlaceholder;

  const unluckiestLoser = losers.length
    ? losers.map(withAllPlay).reduce((a, b) => (b.allPlayWinPct > a.allPlayWinPct ? b : a))
    : noDecidedMatchupPlaceholder;

  return { backedIntoIt: luckiestWinner, robbed: unluckiestLoser };
}

/**
 * How `teamId`'s matchup went, and whether `fixedScore` (their score without the mistake) would
 * have won it (`flipped`), so the roast can't claim a bench mistake cost a game that was won anyway.
 */
export function matchupOutcome(
  matchups: NormalizedMatchup[],
  teamId: number,
  fixedScore: (score: number) => number,
): MatchupOutcome {
  for (const matchup of matchups) {
    const isHome = matchup.home.teamId === teamId;
    if (!isHome && matchup.away.teamId !== teamId) continue;
    const [team, opponent] = isHome ? [matchup.home, matchup.away] : [matchup.away, matchup.home];
    const result = team.score > opponent.score ? 'won' : team.score < opponent.score ? 'lost' : 'tied';
    return {
      result,
      score: team.score,
      opponent: opponent.name,
      opponentScore: opponent.score,
      flipped: result !== 'won' && fixedScore(team.score) > opponent.score,
    };
  }
  throw new Error(`Team ${teamId} isn't in any matchup this week.`);
}

/**
 * Compute all seven awards for one week from its normalized matchups.
 *
 * Awards carry the winner's `teamId` because season tallies count by id, not name: managers
 * rename teams mid-season. `teamId` is missing only on empty placeholders: no Bonehead when no
 * swap would have helped, and no luck awards when no matchup was decided (e.g. a week not yet
 * played). The Sleepwalker's matchup is judged by `optimal`, the number the fact sheet shows,
 * even if ESPN's team score differs from the starters' sum.
 */
export function computeAwards(matchups: NormalizedMatchup[], week: number): WeekAwards {
  const teams = allTeams(matchups);
  const { backedIntoIt, robbed } = computeLuck(matchups, teams);
  const sleepwalker = computeSleepwalker(teams);
  const bonehead = computeBonehead(teams);
  return {
    week,
    results: matchups.map((matchup) => ({
      home: matchup.home.name,
      homeScore: matchup.home.score,
      away: matchup.away.name,
      awayScore: matchup.away.score,
    })),
    juggernaut: computeJuggernaut(teams),
    corpse: computeCorpse(teams),
    ballerOfTheWeek: computeBaller(teams),
    sleepwalker: { ...sleepwalker, matchup: matchupOutcome(matchups, sleepwalker.teamId, () => sleepwalker.optimal) },
    bonehead:
      bonehead.teamId === undefined
        ? bonehead
        : { ...bonehead, matchup: matchupOutcome(matchups, bonehead.teamId, (score) => score + bonehead.regret) },
    backedIntoIt,
    robbed,
  };
}
