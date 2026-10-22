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
    matchup: { result: 'won', score: 80, opponent: 'Echo', opponentScore: 75, mistakeCostTheWin: false },
  },
  bonehead: { team: 'Alpha', teamId: 1, benched: 'A', benchedPoints: 20, started: 'B', startedPoints: 2, slot: 'WR', regret: 18 },
  backedIntoIt: { team: 'Charlie', teamId: 5, score: 70, allPlayWinPercentage: 0.2, allPlay: { beaten: 2, tied: 0, otherTeams: 9 } },
  robbed: { team: 'Alpha', teamId: 1, score: 110, allPlayWinPercentage: 0.75, allPlay: { beaten: 6, tied: 1, otherTeams: 9 } },
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
    heartbreaker: null,
    mercyRule: null,
  },
  winsByTeamId: {
    juggernaut: new Map([[2, 2]]),
    corpse: new Map([[4, 3]]),
    sleepwalker: new Map([[3, 2]]),
    bonehead: new Map(),
    backedIntoIt: new Map([[5, 2]]),
    robbed: new Map([[1, 2], [2, 2]]),
    heartbreaker: new Map(),
    mercyRule: new Map(),
  },
  latestNameByTeamId: new Map(),
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
    expect(lines.some((line) => line.includes('Baller of the Week'))).toBe(false);
  });

  it('skips awards nobody has won yet', () => {
    expect(lines.some((line) => line.includes('The Bonehead'))).toBe(false);
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

  it("calls ESPN's RB/WR/TE slot Flex", () => {
    const flexAwards = { ...awards, bonehead: { ...awards.bonehead, slot: 'RB/WR/TE' } };
    const body = formatEmailBody(flexAwards, 'roast');
    expect(body).toContain('over A (20.0) at Flex');
    expect(body).not.toContain('RB/WR/TE');
  });

  const bonusAwards: Pick<WeekAwards, 'heartbreaker' | 'mercyRule' | 'oneManArmy'> = {
    heartbreaker: { team: 'Alpha', teamId: 1, score: 97, opponent: 'Bravo', opponentScore: 100, margin: 3 },
    mercyRule: { team: 'Charlie', teamId: 5, score: 150, opponent: 'Jurong FC', opponentScore: 85, margin: 65 },
    oneManArmy: { team: 'Delta', teamId: 3, player: 'Dak Prescott', points: 11, teamScore: 26, share: 11 / 26 },
  };

  it('lists the bonus awards someone won after Robbed', () => {
    const lines = formatEmailBody({ ...awards, ...bonusAwards }, 'roast').split('\n');
    const robbedIndex = lines.findIndex((line) => line.startsWith('😤 Robbed'));
    expect(lines.slice(robbedIndex + 1, robbedIndex + 4)).toEqual([
      '💔 Heartbreaker — Alpha lost to Bravo by 3.0',
      '🏳️ Mercy Rule — Charlie beat Jurong FC by 65.0',
      "🪖 One-Man Army — Dak Prescott scored 11.0 of Delta's 26.0 (42%)",
    ]);
  });

  it('leaves out bonus awards nobody won', () => {
    const body = formatEmailBody({ ...awards, mercyRule: bonusAwards.mercyRule }, 'roast');
    expect(body).toContain('Mercy Rule');
    expect(body).not.toContain('Heartbreaker');
    expect(body).not.toContain('One-Man Army');
  });

  it('shows a Heartbreaker or Mercy Rule season leader', () => {
    const lines = formatLeaderboard({ ...leaderboard, leaders: { ...leaderboard.leaders, mercyRule: { teams: ['Charlie'], count: 2 } } });
    expect(lines.at(-1)).toBe('🏳️ Mercy Rule — Charlie ×2');
  });
});
