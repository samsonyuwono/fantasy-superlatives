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
  otherTeams: number;
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
  mistakeCostTheWin: boolean;
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
  backedIntoIt: { team: string; teamId?: number; score: number; allPlayWinPercentage: number; allPlay: AllPlayRecord };
  robbed: { team: string; teamId?: number; score: number; allPlayWinPercentage: number; allPlay: AllPlayRecord };
  heartbreaker?: CloseOrLopsidedResult;
  mercyRule?: CloseOrLopsidedResult;
  oneManArmy?: { team: string; teamId: number; player: string; points: number; teamScore: number; share: number };
}

export interface CloseOrLopsidedResult {
  team: string;
  teamId: number;
  score: number;
  opponent: string;
  opponentScore: number;
  margin: number;
}

export type AwardKey = Exclude<keyof WeekAwards, 'week' | 'results'>;

export interface AwardInfo {
  name: string;
  emoji: string;
  description: string;
  requiredInRoast: boolean;
}

const HEARTBREAKER_MAX_MARGIN = 5;
const MERCY_RULE_MIN_MARGIN = 60;
const ONE_MAN_ARMY_MIN_SHARE = 0.35;

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
  heartbreaker: { name: 'Heartbreaker', emoji: '💔', description: `closest loss, ${HEARTBREAKER_MAX_MARGIN} pts or less`, requiredInRoast: false },
  mercyRule: { name: 'Mercy Rule', emoji: '🏳️', description: `biggest blowout, ${MERCY_RULE_MIN_MARGIN}+ pts`, requiredInRoast: false },
  oneManArmy: {
    name: 'One-Man Army',
    emoji: '🪖',
    description: `one starter scored ${ONE_MAN_ARMY_MIN_SHARE * 100}%+ of the team's points`,
    requiredInRoast: false,
  },
};

const BENCH = 'Bench';
const IR = 'IR';

/** How a lineup slot reads in the recap. ESPN calls the FLEX slot 'RB/WR/TE'; the league calls it Flex. */
export function slotLabel(slot: string): string {
  return slot === 'RB/WR/TE' ? 'Flex' : slot;
}

const isStarter = (player: NormalizedPlayer): boolean => player.slot !== BENCH && player.slot !== IR;
const startersOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter(isStarter);
const benchOf = (team: NormalizedTeam): NormalizedPlayer[] => team.players.filter((player) => player.slot === BENCH);

const allTeams = (matchups: NormalizedMatchup[]): NormalizedTeam[] =>
  matchups.flatMap((matchup) => [matchup.home, matchup.away]);

/**
 * Maximum total points achievable from a team's roster, filling the league's lineup slots
 * (or, if unknown, the slots the manager actually started), using each starter or bench
 * player (never IR) at most once and only in an eligible slot. A slot no free player can
 * fill scores 0. Exact solution via memoized assignment (rosters are small, so this is cheap).
 */
export function optimalLineupPoints(team: NormalizedTeam): number {
  const slots = team.lineupSlots ?? startersOf(team).map((starter) => starter.slot);
  const startablePlayers = team.players.filter((player) => player.slot !== IR);
  const bestTotalByState = new Map<string, number>();

  const solve = (slotIndex: number, usedMask: number): number => {
    if (slotIndex === slots.length) return 0;
    const stateKey = `${slotIndex}:${usedMask}`;
    const cached = bestTotalByState.get(stateKey);
    if (cached !== undefined) return cached;

    const slot = slots[slotIndex]!;
    let best = -Infinity;
    for (let i = 0; i < startablePlayers.length; i++) {
      const playerBit = 1 << i;
      if (usedMask & playerBit) continue;
      const candidate = startablePlayers[i]!;
      if (!candidate.eligibleSlots.includes(slot)) continue;
      const total = candidate.points + solve(slotIndex + 1, usedMask | playerBit);
      if (total > best) best = total;
    }
    const slotUnfillable = best === -Infinity;
    if (slotUnfillable) best = solve(slotIndex + 1, usedMask);
    bestTotalByState.set(stateKey, best);
    return best;
  };

  return solve(0, 0);
}

function computeJuggernaut(teams: NormalizedTeam[]): WeekAwards['juggernaut'] {
  const highestScoring = teams.reduce((highest, team) => (team.score > highest.score ? team : highest));
  return { team: highestScoring.name, teamId: highestScoring.teamId, score: highestScoring.score };
}

function computeCorpse(teams: NormalizedTeam[]): WeekAwards['corpse'] {
  const lowestScoring = teams.reduce((lowest, team) => (team.score < lowest.score ? team : lowest));
  return { team: lowestScoring.name, teamId: lowestScoring.teamId, score: lowestScoring.score };
}

function computeBaller(teams: NormalizedTeam[]): WeekAwards['ballerOfTheWeek'] {
  let topStarter: WeekAwards['ballerOfTheWeek'] | null = null;
  for (const team of teams) {
    for (const player of startersOf(team)) {
      if (!topStarter || player.points > topStarter.points) {
        topStarter = { team: team.name, player: player.name, points: player.points };
      }
    }
  }
  return topStarter!;
}

type Sleepwalker = Omit<WeekAwards['sleepwalker'], 'matchup'>;

function computeSleepwalker(teams: NormalizedTeam[]): Sleepwalker {
  let mostPointsLeft: Sleepwalker | null = null;
  for (const team of teams) {
    const actual = startersOf(team).reduce((sum, player) => sum + player.points, 0);
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

/** Why nobody gets The Bonehead in a week when `computeBonehead` finds no swap that would have helped. */
export const NOBODY_BLUNDERED_REASON = 'no bench player outscored a starter they could have replaced';

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
  const otherTeams = teams.filter((otherTeam) => otherTeam.teamId !== team.teamId);
  return {
    beaten: otherTeams.filter((otherTeam) => team.score > otherTeam.score).length,
    tied: otherTeams.filter((otherTeam) => team.score === otherTeam.score).length,
    otherTeams: otherTeams.length,
  };
}

function allPlayWinPercentage(record: AllPlayRecord): number {
  return record.otherTeams === 0 ? 0 : (record.beaten + record.tied / 2) / record.otherTeams;
}

function computeLuck(
  matchups: NormalizedMatchup[],
  teams: NormalizedTeam[],
): { backedIntoIt: WeekAwards['backedIntoIt']; robbed: WeekAwards['robbed'] } {
  const winners: NormalizedTeam[] = [];
  const losers: NormalizedTeam[] = [];
  for (const matchup of matchups) {
    if (matchup.home.score > matchup.away.score) {
      winners.push(matchup.home);
      losers.push(matchup.away);
    } else if (matchup.away.score > matchup.home.score) {
      winners.push(matchup.away);
      losers.push(matchup.home);
    }
  }

  const withAllPlay = (team: NormalizedTeam) => {
    const allPlay = allPlayRecord(team, teams);
    return { team: team.name, teamId: team.teamId, score: team.score, allPlayWinPercentage: allPlayWinPercentage(allPlay), allPlay };
  };

  const noDecidedMatchupPlaceholder = {
    team: '',
    score: 0,
    allPlayWinPercentage: 0,
    allPlay: { beaten: 0, tied: 0, otherTeams: 0 },
  };

  const luckiestWinner = winners.length
    ? winners.map(withAllPlay).reduce((luckiest, candidate) => (candidate.allPlayWinPercentage < luckiest.allPlayWinPercentage ? candidate : luckiest))
    : noDecidedMatchupPlaceholder;

  const unluckiestLoser = losers.length
    ? losers.map(withAllPlay).reduce((unluckiest, candidate) => (candidate.allPlayWinPercentage > unluckiest.allPlayWinPercentage ? candidate : unluckiest))
    : noDecidedMatchupPlaceholder;

  return { backedIntoIt: luckiestWinner, robbed: unluckiestLoser };
}

const roundedToHundredths = (points: number) => Math.round(points * 100) / 100;

function decidedResults(matchups: NormalizedMatchup[], viewpoint: 'winner' | 'loser'): CloseOrLopsidedResult[] {
  const results: CloseOrLopsidedResult[] = [];
  for (const matchup of matchups) {
    if (matchup.home.score === matchup.away.score) continue;
    const [winner, loser] = matchup.home.score > matchup.away.score ? [matchup.home, matchup.away] : [matchup.away, matchup.home];
    const [team, opponent] = viewpoint === 'winner' ? [winner, loser] : [loser, winner];
    results.push({
      team: team.name,
      teamId: team.teamId,
      score: team.score,
      opponent: opponent.name,
      opponentScore: opponent.score,
      margin: roundedToHundredths(winner.score - loser.score),
    });
  }
  return results;
}

function computeHeartbreaker(matchups: NormalizedMatchup[]): CloseOrLopsidedResult | undefined {
  let closestLoss: CloseOrLopsidedResult | undefined;
  for (const loss of decidedResults(matchups, 'loser')) {
    if (!closestLoss || loss.margin < closestLoss.margin) closestLoss = loss;
  }
  return closestLoss && closestLoss.margin <= HEARTBREAKER_MAX_MARGIN ? closestLoss : undefined;
}

function computeMercyRule(matchups: NormalizedMatchup[]): CloseOrLopsidedResult | undefined {
  let biggestWin: CloseOrLopsidedResult | undefined;
  for (const win of decidedResults(matchups, 'winner')) {
    if (!biggestWin || win.margin > biggestWin.margin) biggestWin = win;
  }
  return biggestWin && biggestWin.margin >= MERCY_RULE_MIN_MARGIN ? biggestWin : undefined;
}

function computeOneManArmy(teams: NormalizedTeam[]): WeekAwards['oneManArmy'] {
  let biggestShare: WeekAwards['oneManArmy'];
  for (const team of teams) {
    if (team.score <= 0) continue;
    for (const starter of startersOf(team)) {
      const share = starter.points / team.score;
      if (!biggestShare || share > biggestShare.share) {
        biggestShare = { team: team.name, teamId: team.teamId, player: starter.name, points: starter.points, teamScore: team.score, share };
      }
    }
  }
  return biggestShare && biggestShare.share >= ONE_MAN_ARMY_MIN_SHARE ? biggestShare : undefined;
}

/**
 * How `teamId`'s matchup went, and whether `fixedScore` (their score without the mistake) would
 * have won it (`mistakeCostTheWin`), so the roast can't claim a bench mistake cost a game that was won anyway.
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
      mistakeCostTheWin: result !== 'won' && fixedScore(team.score) > opponent.score,
    };
  }
  throw new Error(`Team ${teamId} isn't in any matchup this week.`);
}

/**
 * Compute the seven awards for one week from its normalized matchups, plus the bonus awards
 * (Heartbreaker, Mercy Rule, One-Man Army) when someone reached the threshold. A bonus award
 * nobody won is undefined.
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
    heartbreaker: computeHeartbreaker(matchups),
    mercyRule: computeMercyRule(matchups),
    oneManArmy: computeOneManArmy(teams),
  };
}
