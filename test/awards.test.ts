import { describe, it, expect } from 'vitest';
import { computeAwards, optimalLineupPoints } from '../src/awards.js';
import type { NormalizedMatchup, NormalizedPlayer, NormalizedTeam } from '../src/awards.js';

/**
 * Fixture week — 4 teams, 2 matchups. Every award has a single, hand-computed winner.
 *
 * Scores:  Bravo 82 > Alpha 50 > Charlie 47 > Delta 26
 * Matchup 1: Alpha (50) vs Bravo (82)  -> Bravo wins
 * Matchup 2: Charlie (47) vs Delta (26) -> Charlie wins
 *
 * All-play (out of 3):  Bravo 100% | Alpha 66.7% | Charlie 33.3% | Delta 0%
 *   Backed Into It (luckiest win)  = winner w/ lowest all-play% -> Charlie (won but 33.3%)
 *   Robbed (unluckiest loss)       = loser  w/ highest all-play% -> Alpha  (lost but 66.7%)
 *
 * Alpha benched Puka (25 WR) while starting someRB (5) at FLEX:
 *   The Sleepwalker (most points left on bench) -> Alpha (+20)
 *   The Bonehead   (worst single start/sit)     -> Alpha (Puka 25 over someRB 5 = 20 regret)
 */

const p = (name: string, points: number, slot: string, eligibleSlots: string[]): NormalizedPlayer => ({
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
    p('Josh Allen', 20, 'QB', ['QB']),
    p('Bijan Robinson', 15, 'RB', ['RB', 'FLEX']),
    p('Justin Jefferson', 10, 'WR', ['WR', 'FLEX']),
    p('Some Back', 5, 'FLEX', ['RB', 'FLEX']),
    p('Puka Nacua', 25, 'Bench', ['WR', 'FLEX']), // stranded on the bench
    p('Backup QB', 2, 'Bench', ['QB']),
  ],
};

const bravo: NormalizedTeam = {
  teamId: 2,
  name: 'Bravo',
  score: 82,
  players: [
    p('Justin Herbert', 18, 'QB', ['QB']),
    p('Saquon Barkley', 22, 'RB', ['RB', 'FLEX']),
    p("Ja'Marr Chase", 30, 'WR', ['WR', 'FLEX']), // top starter in the league
    p('George Kittle', 12, 'FLEX', ['TE', 'FLEX']),
    p('Bench RB', 3, 'Bench', ['RB', 'FLEX']),
    p('Bench WR', 1, 'Bench', ['WR', 'FLEX']),
  ],
};

const charlie: NormalizedTeam = {
  teamId: 3,
  name: 'Charlie',
  score: 47,
  players: [
    p('Patrick Mahomes', 14, 'QB', ['QB']),
    p('James Cook', 8, 'RB', ['RB', 'FLEX']),
    p('CeeDee Lamb', 16, 'WR', ['WR', 'FLEX']),
    p('Some WR', 9, 'FLEX', ['WR', 'FLEX']),
    p('Bench Zero', 0, 'Bench', ['RB', 'FLEX']),
    p('Bench Four', 4, 'Bench', ['WR', 'FLEX']),
  ],
};

const delta: NormalizedTeam = {
  teamId: 4,
  name: 'Delta',
  score: 26,
  players: [
    p('Dak Prescott', 11, 'QB', ['QB']),
    p('Jahmyr Gibbs', 6, 'RB', ['RB', 'FLEX']),
    p('Davante Adams', 7, 'WR', ['WR', 'FLEX']),
    p('Some TE', 2, 'FLEX', ['TE', 'FLEX']),
    p('Bench Dead', 0, 'Bench', ['RB', 'FLEX']),
    p('Bench Dead 2', 0, 'Bench', ['WR', 'FLEX']),
  ],
};

const matchups: NormalizedMatchup[] = [
  { home: alpha, away: bravo },
  { home: charlie, away: delta },
];

describe('computeAwards', () => {
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

  it('The Sleepwalker left the most points on the bench (optimal - actual)', () => {
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
    expect(awards.backedIntoIt.allPlayWinPct).toBeCloseTo(1 / 3, 3);
    expect(awards.backedIntoIt.allPlay).toEqual({ beaten: 1, tied: 0, opponents: 3 });
  });

  it('Robbed is the unluckiest loss (lost the matchup, highest all-play %)', () => {
    expect(awards.robbed.team).toBe('Alpha');
    expect(awards.robbed.allPlayWinPct).toBeCloseTo(2 / 3, 3);
    expect(awards.robbed.allPlay).toEqual({ beaten: 2, tied: 0, opponents: 3 });
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
    const lost = { result: 'lost', score: 50, opponent: 'Bravo', opponentScore: 82, flipped: false };
    expect(awards.sleepwalker.matchup).toEqual(lost);
    expect(awards.bonehead.matchup).toEqual(lost);
  });

  it('flags a loss the missed points would have won', () => {
    const closeBravo = { ...bravo, score: 60 };
    const close = computeAwards([{ home: alpha, away: closeBravo }, { home: charlie, away: delta }], 3);
    expect(close.sleepwalker.matchup).toMatchObject({ result: 'lost', flipped: true });
    expect(close.bonehead.matchup).toMatchObject({ result: 'lost', flipped: true });
  });

  it('never flags a win as flipped', () => {
    const weakBravo = { ...bravo, score: 40 };
    const won = computeAwards([{ home: alpha, away: weakBravo }, { home: charlie, away: delta }], 3);
    expect(won.sleepwalker.matchup).toEqual({ result: 'won', score: 50, opponent: 'Bravo', opponentScore: 40, flipped: false });
  });

  it("judges the Sleepwalker by the optimal score on the sheet, not ESPN's team score", () => {
    // ESPN says 51 but the starters add up to 50, so optimal is 70: short of Bravo's 70.5.
    const espnAlpha = { ...alpha, score: 51 };
    const closeBravo = { ...bravo, score: 70.5 };
    const close = computeAwards([{ home: espnAlpha, away: closeBravo }, { home: charlie, away: delta }], 3);
    expect(close.sleepwalker).toMatchObject({ optimal: 70, matchup: { result: 'lost', flipped: false } });
  });

  it('flags a tie the missed points would have won', () => {
    const tiedBravo = { ...bravo, score: 50 };
    const tied = computeAwards([{ home: alpha, away: tiedBravo }, { home: charlie, away: delta }], 3);
    expect(tied.sleepwalker.matchup).toMatchObject({ result: 'tied', flipped: true });
  });
});

describe('weeks with no decided matchups (e.g. no scores yet)', () => {
  const tieTeam = (id: number, name: string): NormalizedTeam => ({
    teamId: id,
    name,
    score: 0,
    players: [p(`${name} QB`, 0, 'QB', ['QB'])],
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
  // Lineup: QB + 2x FLEX ('RB/WR/TE'). Two studs are stranded on the bench.
  const twoFlexTeam: NormalizedTeam = {
    teamId: 9,
    name: 'FlexHeavy',
    score: 21, // started 10 + 5 + 6
    players: [
      p('Only QB', 10, 'QB', ['QB']),
      p('Started RB', 5, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      p('Started WR', 6, 'RB/WR/TE', ['WR', 'RB/WR/TE']),
      p('Bench Stud RB', 20, 'Bench', ['RB', 'RB/WR/TE']),
      p('Bench Stud WR', 18, 'Bench', ['WR', 'RB/WR/TE']),
    ],
  };

  it('fills both FLEX slots from the roster without reusing a player', () => {
    // QB (only eligible = 10) + two best FLEX-eligible (20 + 18) = 48.
    expect(optimalLineupPoints(twoFlexTeam)).toBeCloseTo(48, 5);
  });

  it('drives The Sleepwalker off both FLEX spots (48 optimal − 21 actual = 27)', () => {
    const other: NormalizedTeam = {
      teamId: 10,
      name: 'Filler',
      score: 100,
      players: [p('Star', 100, 'QB', ['QB'])],
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
      p('Only QB', 10, 'QB', ['QB']),
      p('Started RB', 5, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      p('Bench WR', 12, 'Bench', ['WR', 'RB/WR/TE']),
    ],
  };

  it('counts the empty slot as fillable from the bench', () => {
    // QB 10 + both FLEX spots (12 + 5) = 27, not just 22 from the slots that were used.
    expect(optimalLineupPoints(emptySlotTeam)).toBeCloseTo(27, 5);
  });

  it('falls back to the started slots when the league lineup is unknown', () => {
    const { lineupSlots: _ignored, ...withoutSlots } = emptySlotTeam;
    expect(optimalLineupPoints(withoutSlots)).toBeCloseTo(22, 5);
  });
});
