import { describe, it, expect } from 'vitest';
import { computeAwards, matchupOutcome, optimalLineupPoints } from '../src/awards.js';
import type { NormalizedMatchup, NormalizedPlayer, NormalizedTeam } from '../src/awards.js';

const player = (name: string, points: number, slot: string, eligibleSlots: string[]): NormalizedPlayer => ({
  name,
  points,
  slot,
  eligibleSlots,
});

const alpha: NormalizedTeam = {
  teamId: 1,
  name: 'Alpha',
  score: 50,
  players: [
    player('Josh Allen', 20, 'QB', ['QB']),
    player('Bijan Robinson', 15, 'RB', ['RB', 'FLEX']),
    player('Justin Jefferson', 10, 'WR', ['WR', 'FLEX']),
    player('Some Back', 5, 'FLEX', ['RB', 'FLEX']),
    player('Puka Nacua', 25, 'Bench', ['WR', 'FLEX']),
    player('Backup QB', 2, 'Bench', ['QB']),
  ],
};

const bravo: NormalizedTeam = {
  teamId: 2,
  name: 'Bravo',
  score: 82,
  players: [
    player('Justin Herbert', 18, 'QB', ['QB']),
    player('Saquon Barkley', 22, 'RB', ['RB', 'FLEX']),
    player("Ja'Marr Chase", 30, 'WR', ['WR', 'FLEX']),
    player('George Kittle', 12, 'FLEX', ['TE', 'FLEX']),
    player('Bench RB', 3, 'Bench', ['RB', 'FLEX']),
    player('Bench WR', 1, 'Bench', ['WR', 'FLEX']),
  ],
};

const charlie: NormalizedTeam = {
  teamId: 3,
  name: 'Charlie',
  score: 47,
  players: [
    player('Patrick Mahomes', 14, 'QB', ['QB']),
    player('James Cook', 8, 'RB', ['RB', 'FLEX']),
    player('CeeDee Lamb', 16, 'WR', ['WR', 'FLEX']),
    player('Some WR', 9, 'FLEX', ['WR', 'FLEX']),
    player('Bench Zero', 0, 'Bench', ['RB', 'FLEX']),
    player('Bench Four', 4, 'Bench', ['WR', 'FLEX']),
  ],
};

const delta: NormalizedTeam = {
  teamId: 4,
  name: 'Delta',
  score: 26,
  players: [
    player('Dak Prescott', 11, 'QB', ['QB']),
    player('Jahmyr Gibbs', 6, 'RB', ['RB', 'FLEX']),
    player('Davante Adams', 7, 'WR', ['WR', 'FLEX']),
    player('Some TE', 2, 'FLEX', ['TE', 'FLEX']),
    player('Bench Dead', 0, 'Bench', ['RB', 'FLEX']),
    player('Bench Dead 2', 0, 'Bench', ['WR', 'FLEX']),
  ],
};

const matchups: NormalizedMatchup[] = [
  { home: alpha, away: bravo },
  { home: charlie, away: delta },
];

describe('computeAwards on a 4-team week where every award has one hand-computed winner', () => {
  const awards = computeAwards(matchups, 3);

  it('The Juggernaut is the highest-scoring team', () => {
    expect(awards.juggernaut.team).toBe('Bravo');
    expect(awards.juggernaut.score).toBe(82);
  });

  it('The Corpse is the lowest-scoring team', () => {
    expect(awards.corpse.team).toBe('Delta');
    expect(awards.corpse.score).toBe(26);
  });

  it('Baller of the Week is the top individual starter (not a benched player)', () => {
    expect(awards.ballerOfTheWeek.team).toBe('Bravo');
    expect(awards.ballerOfTheWeek.player).toBe("Ja'Marr Chase");
    expect(awards.ballerOfTheWeek.points).toBe(30);
  });

  it('The Sleepwalker left the most points on the bench (optimal - actual), e.g. Puka Nacua', () => {
    expect(awards.sleepwalker.team).toBe('Alpha');
    expect(awards.sleepwalker.pointsLeft).toBeCloseTo(20, 5);
    expect(awards.sleepwalker.optimal).toBeCloseTo(70, 5);
    expect(awards.sleepwalker.actual).toBeCloseTo(50, 5);
  });

  it('The Bonehead is the single worst start/sit swap', () => {
    expect(awards.bonehead.team).toBe('Alpha');
    expect(awards.bonehead.benched).toBe('Puka Nacua');
    expect(awards.bonehead.started).toBe('Some Back');
    expect(awards.bonehead.slot).toBe('FLEX');
    expect(awards.bonehead.regret).toBeCloseTo(20, 5);
  });

  it('Backed Into It is the luckiest win (won the matchup, lowest all-play %)', () => {
    expect(awards.backedIntoIt.team).toBe('Charlie');
    expect(awards.backedIntoIt.allPlayWinPercentage).toBeCloseTo(1 / 3, 3);
    expect(awards.backedIntoIt.allPlay).toEqual({ beaten: 1, tied: 0, otherTeams: 3 });
  });

  it('Robbed is the unluckiest loss (lost the matchup, highest all-play %)', () => {
    expect(awards.robbed.team).toBe('Alpha');
    expect(awards.robbed.allPlayWinPercentage).toBeCloseTo(2 / 3, 3);
    expect(awards.robbed.allPlay).toEqual({ beaten: 2, tied: 0, otherTeams: 3 });
  });

  it('reports the week number', () => {
    expect(awards.week).toBe(3);
  });

  it('tags each award with the winning teamId', () => {
    expect(awards.juggernaut.teamId).toBe(2);
    expect(awards.corpse.teamId).toBe(4);
    expect(awards.sleepwalker.teamId).toBe(1);
    expect(awards.bonehead.teamId).toBe(1);
    expect(awards.backedIntoIt.teamId).toBe(3);
    expect(awards.robbed.teamId).toBe(1);
  });
});

describe('matchup results and outcomes', () => {
  const awards = computeAwards(matchups, 3);

  it('lists every matchup result', () => {
    expect(awards.results).toEqual([
      { home: 'Alpha', homeScore: 50, away: 'Bravo', awayScore: 82 },
      { home: 'Charlie', homeScore: 47, away: 'Delta', awayScore: 26 },
    ]);
  });

  it('says Alpha lost, and would have lost even with the optimal lineup (70 < 82)', () => {
    const lost = { result: 'lost', score: 50, opponent: 'Bravo', opponentScore: 82, mistakeCostTheWin: false };
    expect(awards.sleepwalker.matchup).toEqual(lost);
    expect(awards.bonehead.matchup).toEqual(lost);
  });

  it('flags a loss the missed points would have won', () => {
    const closeBravo = { ...bravo, score: 60 };
    const close = computeAwards([{ home: alpha, away: closeBravo }, { home: charlie, away: delta }], 3);
    expect(close.sleepwalker.matchup).toMatchObject({ result: 'lost', mistakeCostTheWin: true });
    expect(close.bonehead.matchup).toMatchObject({ result: 'lost', mistakeCostTheWin: true });
  });

  it('never says a mistake cost a game that was won', () => {
    const weakBravo = { ...bravo, score: 40 };
    const won = computeAwards([{ home: alpha, away: weakBravo }, { home: charlie, away: delta }], 3);
    expect(won.sleepwalker.matchup).toEqual({ result: 'won', score: 50, opponent: 'Bravo', opponentScore: 40, mistakeCostTheWin: false });
  });

  it("judges the Sleepwalker by the optimal score on the sheet (70), not ESPN's team score (51 vs starters' 50)", () => {
    const espnAlpha = { ...alpha, score: 51 };
    const closeBravo = { ...bravo, score: 70.5 };
    const close = computeAwards([{ home: espnAlpha, away: closeBravo }, { home: charlie, away: delta }], 3);
    expect(close.sleepwalker).toMatchObject({ optimal: 70, matchup: { result: 'lost', mistakeCostTheWin: false } });
  });

  it('flags a tie the missed points would have won', () => {
    const tiedBravo = { ...bravo, score: 50 };
    const tied = computeAwards([{ home: alpha, away: tiedBravo }, { home: charlie, away: delta }], 3);
    expect(tied.sleepwalker.matchup).toMatchObject({ result: 'tied', mistakeCostTheWin: true });
  });
});

describe('matchupOutcome', () => {
  it('throws for a team that is not in any matchup, since that would be a bug', () => {
    expect(() => matchupOutcome(matchups, 99, (score) => score)).toThrow("Team 99 isn't in any matchup this week.");
  });

  it('leaves the Bonehead without a matchup when nobody blundered', () => {
    const noBench = (team: NormalizedTeam): NormalizedTeam => ({ ...team, players: team.players.filter((rosterPlayer) => rosterPlayer.slot !== 'Bench') });
    const awards = computeAwards([{ home: noBench(alpha), away: noBench(bravo) }], 3);
    expect(awards.bonehead.teamId).toBeUndefined();
    expect(awards.bonehead.matchup).toBeUndefined();
    expect(awards.sleepwalker.matchup).toBeDefined();
  });
});

describe('weeks with no decided matchups (e.g. no scores yet)', () => {
  const tieTeam = (teamId: number, name: string): NormalizedTeam => ({
    teamId,
    name,
    score: 0,
    players: [player(`${name} QB`, 0, 'QB', ['QB'])],
  });

  it('does not throw when every matchup is a tie', () => {
    const matchups = [{ home: tieTeam(1, 'A'), away: tieTeam(2, 'B') }];
    expect(() => computeAwards(matchups, 14)).not.toThrow();
  });

  it('returns placeholder luck awards rather than crashing', () => {
    const matchups = [{ home: tieTeam(1, 'A'), away: tieTeam(2, 'B') }];
    const awards = computeAwards(matchups, 14);
    expect(awards.backedIntoIt.team).toBe('');
    expect(awards.robbed.team).toBe('');
    expect(awards.backedIntoIt.teamId).toBeUndefined();
    expect(awards.robbed.teamId).toBeUndefined();
  });
});

describe('optimalLineupPoints with two FLEX slots', () => {
  const twoFlexTeam: NormalizedTeam = {
    teamId: 9,
    name: 'FlexHeavy',
    score: 10 + 5 + 6,
    players: [
      player('Only QB', 10, 'QB', ['QB']),
      player('Started RB', 5, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      player('Started WR', 6, 'RB/WR/TE', ['WR', 'RB/WR/TE']),
      player('Bench Stud RB', 20, 'Bench', ['RB', 'RB/WR/TE']),
      player('Bench Stud WR', 18, 'Bench', ['WR', 'RB/WR/TE']),
    ],
  };

  it('fills both FLEX slots from the roster without reusing a player', () => {
    const onlyQb = 10;
    const twoBenchStuds = 20 + 18;
    expect(optimalLineupPoints(twoFlexTeam)).toBeCloseTo(onlyQb + twoBenchStuds, 5);
  });

  it('drives The Sleepwalker off both FLEX spots (48 optimal − 21 actual = 27)', () => {
    const other: NormalizedTeam = {
      teamId: 10,
      name: 'Filler',
      score: 100,
      players: [player('Star', 100, 'QB', ['QB'])],
    };
    const awards = computeAwards([{ home: twoFlexTeam, away: other }], 1);
    expect(awards.sleepwalker.team).toBe('FlexHeavy');
    expect(awards.sleepwalker.pointsLeft).toBeCloseTo(27, 5);
  });
});

describe('optimalLineupPoints with league lineup slots (empty starting slot)', () => {
  const emptySlotTeam: NormalizedTeam = {
    teamId: 11,
    name: 'Forgetful',
    score: 15,
    lineupSlots: ['QB', 'RB/WR/TE', 'RB/WR/TE'],
    players: [
      player('Only QB', 10, 'QB', ['QB']),
      player('Started RB', 5, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      player('Bench WR', 12, 'Bench', ['WR', 'RB/WR/TE']),
    ],
  };

  it('counts the empty slot as fillable from the bench', () => {
    const qbPlusBothFlexSpots = 10 + 12 + 5;
    expect(optimalLineupPoints(emptySlotTeam)).toBeCloseTo(qbPlusBothFlexSpots, 5);
  });

  it('falls back to the started slots when the league lineup is unknown', () => {
    const { lineupSlots: _ignored, ...withoutSlots } = emptySlotTeam;
    expect(optimalLineupPoints(withoutSlots)).toBeCloseTo(22, 5);
  });
});

const teamScoring = (teamId: number, score: number, starterPoints: number[] = [score]): NormalizedTeam => ({
  teamId,
  name: `Team ${teamId}`,
  score,
  players: starterPoints.map((points, index) => player(`Starter ${teamId}.${index + 1}`, points, 'RB', ['RB'])),
});

const matchupOf = (homeScore: number, awayScore: number, homeId: number, awayId: number): NormalizedMatchup => ({
  home: teamScoring(homeId, homeScore),
  away: teamScoring(awayId, awayScore),
});

describe('bonus awards on the 4-team week', () => {
  const awards = computeAwards(matchups, 3);

  it('gives no Heartbreaker when the closest loss is by 21', () => {
    expect(awards.heartbreaker).toBeUndefined();
  });

  it('gives no Mercy Rule when the biggest win is by 32', () => {
    expect(awards.mercyRule).toBeUndefined();
  });

  it("gives One-Man Army to Delta, since Dak Prescott's 11 is 42% of their 26", () => {
    expect(awards.oneManArmy).toEqual({
      team: 'Delta',
      teamId: 4,
      player: 'Dak Prescott',
      points: 11,
      teamScore: 26,
      share: 11 / 26,
    });
  });
});

describe('Heartbreaker', () => {
  it('goes to the loser with the smallest margin, up to 5 points', () => {
    const awards = computeAwards([matchupOf(100, 120, 1, 2), matchupOf(97, 100, 3, 4)], 1);
    expect(awards.heartbreaker).toEqual({
      team: 'Team 3',
      teamId: 3,
      score: 97,
      opponent: 'Team 4',
      opponentScore: 100,
      margin: 3,
    });
  });

  it('counts a margin of exactly 5, even when the subtraction is a floating-point near miss', () => {
    expect(computeAwards([matchupOf(105.3, 100.3, 1, 2)], 1).heartbreaker?.teamId).toBe(2);
    expect(computeAwards([matchupOf(100, 105, 1, 2)], 1).heartbreaker?.margin).toBe(5);
  });

  it('skips a loss by 5.01', () => {
    expect(computeAwards([matchupOf(100, 105.01, 1, 2)], 1).heartbreaker).toBeUndefined();
  });

  it('never goes to a tie', () => {
    expect(computeAwards([matchupOf(100, 100, 1, 2), matchupOf(90, 120, 3, 4)], 1).heartbreaker).toBeUndefined();
  });

  it('goes to the first one found when two losses tie on margin', () => {
    expect(computeAwards([matchupOf(98, 100, 1, 2), matchupOf(110, 108, 3, 4)], 1).heartbreaker?.teamId).toBe(1);
  });
});

describe('Mercy Rule', () => {
  it('goes to the winner of the biggest blowout, from 60 points', () => {
    const awards = computeAwards([matchupOf(150, 85, 1, 2), matchupOf(60, 130, 3, 4)], 1);
    expect(awards.mercyRule).toEqual({
      team: 'Team 4',
      teamId: 4,
      score: 130,
      opponent: 'Team 3',
      opponentScore: 60,
      margin: 70,
    });
  });

  it('counts a margin of exactly 60, and skips 59.99', () => {
    expect(computeAwards([matchupOf(160.3, 100.3, 1, 2)], 1).mercyRule?.margin).toBe(60);
    expect(computeAwards([matchupOf(159.99, 100, 1, 2)], 1).mercyRule).toBeUndefined();
  });

  it('goes to the first one found when two blowouts tie on margin', () => {
    expect(computeAwards([matchupOf(70, 140, 1, 2), matchupOf(150, 80, 3, 4)], 1).mercyRule?.teamId).toBe(2);
  });
});

describe('One-Man Army', () => {
  const week = (home: NormalizedTeam, away: NormalizedTeam) => computeAwards([{ home, away }], 1).oneManArmy;

  it('counts a share of exactly 35%, and skips 34.9%', () => {
    expect(week(teamScoring(1, 100, [35, 33, 32]), teamScoring(2, 100, [34, 33, 33]))?.teamId).toBe(1);
    expect(week(teamScoring(1, 100, [34.9, 33, 32.1]), teamScoring(2, 100, [34, 33, 33]))).toBeUndefined();
  });

  it('skips a team that scored 0 or less', () => {
    expect(week(teamScoring(1, 0, [0, 0]), teamScoring(2, -2, [3, -5]))).toBeUndefined();
  });

  it('ignores benched players', () => {
    const benchHero: NormalizedTeam = {
      ...teamScoring(1, 100, [34, 33, 33]),
      players: [...teamScoring(1, 100, [34, 33, 33]).players, player('Bench Hero', 60, 'Bench', ['RB'])],
    };
    expect(week(benchHero, teamScoring(2, 100, [34, 33, 33]))).toBeUndefined();
  });

  it('goes to the first one found when two teams tie on share', () => {
    expect(week(teamScoring(1, 100, [50, 50]), teamScoring(2, 80, [40, 40]))?.teamId).toBe(1);
  });

  it('works the same for a 2-FLEX no-kicker lineup and a kicker 1-FLEX lineup', () => {
    const twoFlexNoKicker: NormalizedTeam = {
      teamId: 1,
      name: 'Two Flex',
      score: 100,
      lineupSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB/WR/TE', 'RB/WR/TE', 'D/ST'],
      players: [
        player('Big Flex', 40, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
        player('Other Flex', 10, 'RB/WR/TE', ['WR', 'RB/WR/TE']),
        player('Quarterback', 20, 'QB', ['QB']),
        player('Rest', 30, 'RB', ['RB', 'RB/WR/TE']),
      ],
    };
    const kickerOneFlex: NormalizedTeam = {
      teamId: 2,
      name: 'Kicker',
      score: 100,
      lineupSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB/WR/TE', 'D/ST', 'K'],
      players: [
        player('Big Kicker', 40, 'K', ['K']),
        player('Flex', 10, 'RB/WR/TE', ['WR', 'RB/WR/TE']),
        player('Quarterback', 20, 'QB', ['QB']),
        player('Rest', 30, 'RB', ['RB', 'RB/WR/TE']),
      ],
    };
    expect(week(twoFlexNoKicker, teamScoring(3, 100, [30, 35, 35]))).toMatchObject({ player: 'Big Flex', share: 0.4 });
    expect(week(teamScoring(3, 100, [30, 35, 35]), kickerOneFlex)).toMatchObject({ player: 'Big Kicker', share: 0.4 });
  });
});
