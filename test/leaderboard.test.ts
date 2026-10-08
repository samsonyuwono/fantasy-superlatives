import { describe, it, expect } from 'vitest';
import { buildLeaderboard } from '../src/leaderboard.js';
import type { NormalizedMatchup, NormalizedPlayer, NormalizedTeam } from '../src/awards.js';

const p = (name: string, points: number, slot: string, eligibleSlots: string[]): NormalizedPlayer => ({
  name,
  points,
  slot,
  eligibleSlots,
});

/**
 * A minimal team in a QB + 1 FLEX league: one QB and one FLEX starter, plus one bench player.
 * score = qb + flex; benchPts is what the bench player scored (left on the bench if > flex).
 */
const team = (teamId: number, name: string, qb: number, flex: number, benchPts = 0): NormalizedTeam => ({
  teamId,
  name,
  score: qb + flex,
  lineupSlots: ['QB', 'RB/WR/TE'],
  players: [
    p(`${name} QB`, qb, 'QB', ['QB']),
    p(`${name} FLEX`, flex, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
    p(`${name} Bench`, benchPts, 'Bench', ['WR', 'RB/WR/TE']),
  ],
});

const week = (n: number, matchups: NormalizedMatchup[]) => ({ week: n, matchups });

describe('buildLeaderboard', () => {
  /**
   * Week 1: A 30 v B 10, C 25 v D 5   -> Juggernaut A, Corpse D
   * Week 2: A 40 v B 12, C 20 v D 8   -> Juggernaut A, Corpse D
   * Week 3: A 15 v B 50, C 22 v D 6   -> Juggernaut B, Corpse D
   */
  const weeks = [
    week(1, [{ home: team(1, 'A', 20, 10), away: team(2, 'B', 5, 5) }, { home: team(3, 'C', 15, 10), away: team(4, 'D', 3, 2) }]),
    week(2, [{ home: team(1, 'A', 30, 10), away: team(2, 'B', 6, 6) }, { home: team(3, 'C', 10, 10), away: team(4, 'D', 4, 4) }]),
    week(3, [{ home: team(1, 'A', 10, 5), away: team(2, 'B', 40, 10) }, { home: team(3, 'C', 12, 10), away: team(4, 'D', 3, 3) }]),
  ];
  const lb = buildLeaderboard(weeks)!;

  it('counts each award across the weeks and names the leader', () => {
    expect(lb.weeks).toEqual([1, 2, 3]);
    expect(lb.leaders.juggernaut).toEqual({ teams: ['A'], count: 2 });
    expect(lb.leaders.corpse).toEqual({ teams: ['D'], count: 3 });
    expect(lb.counts.juggernaut.get(2)).toBe(1);
  });

  // Only Weeks 1 and 3: A and B each have one Juggernaut, and B and A each have one Robbed.
  const oneEach = buildLeaderboard([weeks[0]!, weeks[2]!])!;

  it('has no leader for an award until someone has won it twice', () => {
    expect(oneEach.leaders.robbed).toBeNull();
    expect(oneEach.counts.robbed.get(1)).toBe(1);
    expect(oneEach.counts.robbed.get(2)).toBe(1);
  });

  it('always names a Juggernaut leader, even when tied at one win', () => {
    expect(oneEach.leaders.juggernaut).toEqual({ teams: ['A', 'B'], count: 1 });
  });

  it('accepts weeks in any order', () => {
    expect(buildLeaderboard([...weeks].reverse())!.weeks).toEqual([1, 2, 3]);
  });

  it('lists every team tied for the lead', () => {
    // Weeks 1–3 plus a Week 4 that B wins: A and B each have two Juggernauts.
    const week4 = week(4, [{ home: team(1, 'A', 5, 5), away: team(2, 'B', 30, 30) }, { home: team(3, 'C', 5, 5), away: team(4, 'D', 3, 3) }]);
    const tied = buildLeaderboard([...weeks, week4])!;
    expect(tied.leaders.juggernaut).toEqual({ teams: ['A', 'B'], count: 2 });
  });

  it('returns null for an award nobody has won, and undefined with no scored weeks', () => {
    // Every team scored 10 in a QB-only lineup: no Bonehead swap is possible.
    expect(lb.leaders.bonehead).toBeNull();
    const zero = week(4, [{ home: team(1, 'A', 0, 0), away: team(2, 'B', 0, 0) }]);
    expect(buildLeaderboard([zero])).toBeUndefined();
  });

  it('skips weeks where nobody has scored yet', () => {
    const zero = week(4, [{ home: team(1, 'A', 0, 0), away: team(2, 'B', 0, 0) }]);
    const withZero = buildLeaderboard([...weeks, zero])!;
    expect(withZero.weeks).toEqual([1, 2, 3]);
    expect(withZero.leaders.corpse).toEqual({ teams: ['D'], count: 3 });
  });

  it('skips placeholder luck awards when no matchup was decided', () => {
    const allTies = week(1, [{ home: team(1, 'A', 10, 5), away: team(2, 'B', 10, 5) }]);
    const result = buildLeaderboard([allTies])!;
    expect(result.leaders.backedIntoIt).toBeNull();
    expect(result.leaders.robbed).toBeNull();
  });

  it('treats a renamed team as one team and shows its latest name', () => {
    const renamed = [
      week(1, [{ home: team(1, 'Old Name', 1, 1), away: team(2, 'B', 20, 20) }]),
      week(2, [{ home: team(1, 'New Name', 1, 1), away: team(2, 'B', 20, 20) }]),
    ];
    const result = buildLeaderboard(renamed)!;
    expect(result.leaders.corpse).toEqual({ teams: ['New Name'], count: 2 });
  });

  it('counts Sleepwalker wins, so the week a team leaves the most on the bench is what matters', () => {
    // Week 1: X leaves 9 (bench 12 over flex 3), Y leaves 10 -> Y.  Week 2: X leaves 9, Y leaves 0 -> X.
    // Week 3: X leaves 9, Y leaves 10 -> Y.
    const bench = [
      week(1, [{ home: team(1, 'X', 10, 3, 12), away: team(2, 'Y', 10, 2, 12) }]),
      week(2, [{ home: team(1, 'X', 10, 3, 12), away: team(2, 'Y', 10, 5, 0) }]),
      week(3, [{ home: team(1, 'X', 10, 3, 12), away: team(2, 'Y', 10, 2, 12) }]),
    ];
    const result = buildLeaderboard(bench)!;
    expect(result.leaders.sleepwalker).toEqual({ teams: ['Y'], count: 2 });
  });
});

describe('buildLeaderboard across lineup shapes', () => {
  // A kicker league with one FLEX: the kicker on the bench outscored the started one.
  const kTeam = (teamId: number, name: string, benchK: number): NormalizedTeam => ({
    teamId,
    name,
    score: 20,
    lineupSlots: ['QB', 'RB/WR/TE', 'K'],
    players: [
      p(`${name} QB`, 10, 'QB', ['QB']),
      p(`${name} FLEX`, 8, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      p(`${name} K`, 2, 'K', ['K']),
      p(`${name} Bench K`, benchK, 'Bench', ['K']),
    ],
  });

  // A two-FLEX league with no kicker, where one FLEX slot was left empty.
  const twoFlexTeam = (teamId: number, name: string, benchFlex: number): NormalizedTeam => ({
    teamId,
    name,
    score: 18,
    lineupSlots: ['QB', 'RB/WR/TE', 'RB/WR/TE'],
    players: [
      p(`${name} QB`, 10, 'QB', ['QB']),
      p(`${name} FLEX`, 8, 'RB/WR/TE', ['RB', 'RB/WR/TE']),
      p(`${name} Bench`, benchFlex, 'Bench', ['WR', 'RB/WR/TE']),
    ],
  });

  it('counts a benched kicker in a K league', () => {
    const lb = buildLeaderboard([
      week(1, [{ home: kTeam(1, 'Kicky', 9), away: kTeam(2, 'Steady', 2) }]),
      week(2, [{ home: kTeam(1, 'Kicky', 9), away: kTeam(2, 'Steady', 2) }]),
    ])!;
    expect(lb.leaders.bonehead).toEqual({ teams: ['Kicky'], count: 2 });
  });

  it('counts an empty FLEX slot in a two-FLEX league', () => {
    const lb = buildLeaderboard([
      week(1, [{ home: twoFlexTeam(1, 'Forgetful', 15), away: twoFlexTeam(2, 'Tidy', 0) }]),
      week(2, [{ home: twoFlexTeam(1, 'Forgetful', 15), away: twoFlexTeam(2, 'Tidy', 0) }]),
    ])!;
    expect(lb.leaders.sleepwalker).toEqual({ teams: ['Forgetful'], count: 2 });
  });
});
