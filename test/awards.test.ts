import { describe, it, expect } from 'vitest';
import { computeAwards } from '../src/awards.js';
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
  });

  it('Robbed is the unluckiest loss (lost the matchup, highest all-play %)', () => {
    expect(awards.robbed.team).toBe('Alpha');
    expect(awards.robbed.allPlayWinPct).toBeCloseTo(2 / 3, 3);
  });

  it('reports the week number', () => {
    expect(awards.week).toBe(3);
  });
});
