import { describe, it, expect } from 'vitest';
import { factSheet } from '../src/roast.js';
import type { WeekAwards } from '../src/awards.js';
import type { SeasonLeaderboard } from '../src/leaderboard.js';

const awards: WeekAwards = {
  week: 5,
  juggernaut: { team: 'Bravo', teamId: 2, score: 120 },
  corpse: { team: 'Jurong FC', teamId: 4, score: 60 },
  ballerOfTheWeek: { team: 'Alpha', player: 'Puka Nacua', points: 31 },
  sleepwalker: { team: 'Delta', teamId: 3, pointsLeft: 40, actual: 80, optimal: 120 },
  bonehead: { team: '', benched: '', benchedPoints: 0, started: '', startedPoints: 0, slot: '', regret: 0 },
  backedIntoIt: { team: 'Charlie', teamId: 5, score: 70, allPlayWinPct: 0.2, allPlay: { beaten: 2, tied: 0, opponents: 9 } },
  robbed: { team: 'Alpha', teamId: 1, score: 110, allPlayWinPct: 0.75, allPlay: { beaten: 6, tied: 1, opponents: 9 } },
};

const leaderboard: SeasonLeaderboard = {
  weeks: [1, 2, 3, 4, 5],
  leaders: {
    juggernaut: { teams: ['Echo'], count: 2 },
    corpse: { teams: ['Jurong FC'], count: 3 },
    sleepwalker: null,
    bonehead: null,
    backedIntoIt: null,
    robbed: { teams: ['Alpha', 'Bravo'], count: 2 },
  },
  counts: {
    juggernaut: new Map([[2, 1], [6, 2]]),
    corpse: new Map([[4, 3]]),
    sleepwalker: new Map([[3, 1]]),
    bonehead: new Map(),
    backedIntoIt: new Map([[5, 1]]),
    robbed: new Map([[1, 2], [2, 2]]),
  },
  nameById: new Map(),
};

describe('factSheet', () => {
  it('describes the luck awards as how many of the other teams they would have beaten', () => {
    const sheet = factSheet(awards);
    expect(sheet).toContain('Charlie won with 70.0 pts (would have beaten 2 of the other 9 teams)');
    expect(sheet).toContain('Alpha lost with 110.0 pts (would have beaten 6 of the other 9 teams and tied 1)');
    expect(sheet).not.toContain('%');
  });

  it('says nobody gets the luck awards when every matchup was a tie', () => {
    const empty = { team: '', score: 0, allPlayWinPct: 0, allPlay: { beaten: 0, tied: 0, opponents: 0 } };
    const sheet = factSheet({ ...awards, backedIntoIt: empty, robbed: empty });
    expect(sheet).toContain('- Backed Into It (luckiest win): nobody, since every matchup this week was a tie');
    expect(sheet).toContain('- Robbed (unluckiest loss): nobody, since every matchup this week was a tie');
  });

  it('has no season section without a leaderboard', () => {
    expect(factSheet(awards)).not.toContain('Season so far');
  });

  it('calls out this week\'s repeat winners only', () => {
    const sheet = factSheet(awards, leaderboard);
    expect(sheet).toContain('Season so far (Weeks 1–5)');
    expect(sheet).toContain('Jurong FC has now won The Corpse 3 times this season');
    // Bravo's Juggernaut this week is its first, so it isn't a repeat.
    expect(sheet).not.toContain('Bravo has now won');
  });

  it('lists the season leaders', () => {
    const sheet = factSheet(awards, leaderboard);
    expect(sheet).toContain('Season leader for The Juggernaut: Echo with 2');
    expect(sheet).toContain('Season leader for Robbed: Alpha and Bravo with 2');
    expect(sheet).not.toContain('Season leader for Baller of the Week');
    expect(sheet).not.toContain('Season leader for The Sleepwalker');
    expect(sheet).not.toContain('Season leader for The Bonehead');
  });
});
