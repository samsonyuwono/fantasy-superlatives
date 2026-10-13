import { describe, it, expect } from 'vitest';
import { formatEmailBody, formatLeaderboard, formatSubject } from '../src/format.js';
import type { WeekAwards } from '../src/awards.js';
import type { SeasonLeaderboard } from '../src/leaderboard.js';

describe('formatSubject', () => {
  it('includes the league name so multiple leagues to one inbox are distinguishable', () => {
    expect(formatSubject(1, 'Main League')).toBe('🏈 Main League — Week 1 Superlatives');
  });

  it('reflects the week number', () => {
    expect(formatSubject(14, 'Dynasty')).toBe('🏈 Dynasty — Week 14 Superlatives');
  });
});

const awards: WeekAwards = {
  week: 5,
  results: [],
  juggernaut: { team: 'Bravo', teamId: 2, score: 120 },
  corpse: { team: 'Jurong FC', teamId: 4, score: 60 },
  ballerOfTheWeek: { team: 'Alpha', player: 'Puka Nacua', points: 31 },
  sleepwalker: {
    team: 'Delta', teamId: 3, pointsLeft: 40, actual: 80, optimal: 120,
    matchup: { result: 'won', score: 80, opponent: 'Echo', opponentScore: 75, flipped: false },
  },
  bonehead: { team: 'Alpha', teamId: 1, benched: 'A', benchedPoints: 20, started: 'B', startedPoints: 2, slot: 'WR', regret: 18 },
  backedIntoIt: { team: 'Charlie', teamId: 5, score: 70, allPlayWinPct: 0.2, allPlay: { beaten: 2, tied: 0, opponents: 9 } },
  robbed: { team: 'Alpha', teamId: 1, score: 110, allPlayWinPct: 0.75, allPlay: { beaten: 6, tied: 1, opponents: 9 } },
};

const leaderboard: SeasonLeaderboard = {
  weeks: [1, 2, 3, 4, 5],
  leaders: {
    juggernaut: { teams: ['Bravo'], count: 2 },
    corpse: { teams: ['Jurong FC'], count: 3 },
    sleepwalker: { teams: ['Delta'], count: 2 },
    bonehead: null,
    backedIntoIt: { teams: ['Charlie'], count: 2 },
    robbed: { teams: ['Alpha', 'Bravo'], count: 2 },
  },
  counts: {
    juggernaut: new Map([[2, 2]]),
    corpse: new Map([[4, 3]]),
    sleepwalker: new Map([[3, 2]]),
    bonehead: new Map(),
    backedIntoIt: new Map([[5, 2]]),
    robbed: new Map([[1, 2], [2, 2]]),
  },
  nameById: new Map(),
};

describe('formatLeaderboard', () => {
  const lines = formatLeaderboard(leaderboard);

  it('titles the section with the weeks covered', () => {
    expect(lines).toContain('📊 SEASON LEADERBOARD (Weeks 1–5)');
  });

  it('lists each award leader with their count, joining ties', () => {
    expect(lines).toContain('💀 The Corpse — Jurong FC ×3');
    expect(lines).toContain('😤 Robbed — Alpha, Bravo ×2');
  });

  it('leaves out Baller of the Week, which is about a player, not a team', () => {
    expect(lines.some((l) => l.includes('Baller of the Week'))).toBe(false);
  });

  it('skips awards nobody has won yet', () => {
    expect(lines.some((l) => l.includes('The Bonehead'))).toBe(false);
  });

  it('shows The Sleepwalker as a win count like the other awards', () => {
    expect(lines).toContain('😴 The Sleepwalker — Delta ×2');
    expect(lines.at(-1)).toBe('😤 Robbed — Alpha, Bravo ×2');
  });
});

describe('formatEmailBody', () => {
  it('adds the leaderboard after the weekly awards when there is one', () => {
    const body = formatEmailBody(awards, 'roast', leaderboard);
    expect(body.indexOf('SEASON LEADERBOARD')).toBeGreaterThan(body.indexOf('WEEK 5 AWARDS'));
  });

  it('leaves the leaderboard out when there is none', () => {
    expect(formatEmailBody(awards, 'roast')).not.toContain('SEASON LEADERBOARD');
  });
});
