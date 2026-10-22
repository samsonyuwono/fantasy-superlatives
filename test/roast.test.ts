import { describe, it, expect, vi, type Mocked } from 'vitest';
import { factSheet, generateRoast, MAX_ATTEMPTS, parsePipelineMode, runPipeline, type RoastDependencies } from '../src/roast.js';
import type { Agents, Verdict } from '../src/agents.js';
import { verifyDraft } from '../src/factcheck.js';
import type { WeekAwards } from '../src/awards.js';
import type { SeasonLeaderboard } from '../src/leaderboard.js';

const awards: WeekAwards = {
  week: 5,
  results: [
    { home: 'Alpha', homeScore: 110, away: 'Bravo', awayScore: 120 },
    { home: 'Charlie', homeScore: 70, away: 'Jurong FC', awayScore: 60 },
    { home: 'Delta', homeScore: 80, away: 'Echo', awayScore: 80 },
  ],
  juggernaut: { team: 'Bravo', teamId: 2, score: 120 },
  corpse: { team: 'Jurong FC', teamId: 4, score: 60 },
  ballerOfTheWeek: { team: 'Alpha', player: 'Puka Nacua', points: 31 },
  sleepwalker: {
    team: 'Delta', teamId: 3, pointsLeft: 40, actual: 80, optimal: 120,
    matchup: { result: 'tied', score: 80, opponent: 'Echo', opponentScore: 80, mistakeCostTheWin: true },
  },
  bonehead: { team: '', benched: '', benchedPoints: 0, started: '', startedPoints: 0, slot: '', regret: 0 },
  backedIntoIt: { team: 'Charlie', teamId: 5, score: 70, allPlayWinPercentage: 0.2, allPlay: { beaten: 2, tied: 0, otherTeams: 9 } },
  robbed: { team: 'Alpha', teamId: 1, score: 110, allPlayWinPercentage: 0.75, allPlay: { beaten: 6, tied: 1, otherTeams: 9 } },
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
    heartbreaker: null,
    mercyRule: null,
  },
  winsByTeamId: {
    juggernaut: new Map([[2, 1], [6, 2]]),
    corpse: new Map([[4, 3]]),
    sleepwalker: new Map([[3, 1]]),
    bonehead: new Map(),
    backedIntoIt: new Map([[5, 1]]),
    robbed: new Map([[1, 2], [2, 2]]),
    heartbreaker: new Map(),
    mercyRule: new Map(),
  },
  latestNameByTeamId: new Map(),
};

describe('factSheet', () => {
  it('lists every matchup result, including ties', () => {
    const sheet = factSheet(awards);
    expect(sheet).toContain('Matchup results:\n- Bravo beat Alpha, 120.0–110.0 (by 10.0)\n- Charlie beat Jurong FC, 70.0–60.0 (by 10.0)\n- Delta and Echo tied at 80.0');
  });

  it('says when the Sleepwalker still won, so the bench did not cost them', () => {
    const sleepwalker = { ...awards.sleepwalker, matchup: { result: 'won' as const, score: 80, opponent: 'Echo', opponentScore: 75, mistakeCostTheWin: false } };
    expect(factSheet({ ...awards, sleepwalker })).toContain(
      "Delta still won 80.0–75.0 over Echo, so the points left on the bench didn't cost them the game.",
    );
  });

  it('says when the Bonehead swap would have won a lost game', () => {
    const bonehead = {
      team: 'Alpha', teamId: 1, benched: 'A', benchedPoints: 20, started: 'B', startedPoints: 2, slot: 'WR', regret: 18,
      matchup: { result: 'lost' as const, score: 110, opponent: 'Bravo', opponentScore: 120, mistakeCostTheWin: true },
    };
    expect(factSheet({ ...awards, bonehead })).toContain(
      'Alpha lost 110.0–120.0 to Bravo, and with the right start/sit they would have won.',
    );
  });

  it("calls ESPN's RB/WR/TE slot Flex so the roast does too", () => {
    const bonehead = {
      team: 'Alpha', teamId: 1, benched: 'A', benchedPoints: 20, started: 'B', startedPoints: 2, slot: 'RB/WR/TE', regret: 18,
      matchup: { result: 'won' as const, score: 120, opponent: 'Bravo', opponentScore: 110, mistakeCostTheWin: false },
    };
    const sheet = factSheet({ ...awards, bonehead });
    expect(sheet).toContain('started B (2.0) at Flex —');
    expect(sheet).not.toContain('RB/WR/TE');
  });

  it('says when a tie would have happened anyway', () => {
    const sleepwalker = { ...awards.sleepwalker, matchup: { result: 'tied' as const, score: 80, opponent: 'Echo', opponentScore: 80, mistakeCostTheWin: false } };
    expect(factSheet({ ...awards, sleepwalker })).toContain(
      "Delta tied Echo at 80.0, so the points left on the bench didn't cost them the win.",
    );
  });

  it('says when a loss would have happened anyway', () => {
    const sleepwalker = { ...awards.sleepwalker, matchup: { result: 'lost' as const, score: 80, opponent: 'Echo', opponentScore: 150, mistakeCostTheWin: false } };
    expect(factSheet({ ...awards, sleepwalker })).toContain('Delta lost 80.0–150.0 to Echo, and would have lost even with their best lineup.');
  });

  it('describes the luck awards as how many of the other teams they would have beaten', () => {
    const sheet = factSheet(awards);
    expect(sheet).toContain('Charlie won with 70.0 pts (would have beaten 2 of the other 9 teams)');
    expect(sheet).toContain('Alpha lost with 110.0 pts (would have beaten 6 of the other 9 teams and tied 1)');
    expect(sheet).not.toContain('%');
  });

  it('says nobody gets the luck awards when every matchup was a tie', () => {
    const empty = { team: '', score: 0, allPlayWinPercentage: 0, allPlay: { beaten: 0, tied: 0, otherTeams: 0 } };
    const sheet = factSheet({ ...awards, backedIntoIt: empty, robbed: empty });
    expect(sheet).toContain('- Backed Into It (luckiest win): nobody, since every matchup this week was a tie');
    expect(sheet).toContain('- Robbed (unluckiest loss): nobody, since every matchup this week was a tie');
  });

  it('says nobody is the Bonehead when no bench player outscored a starter they could have replaced', () => {
    const sheet = factSheet(awards);
    expect(sheet).toContain('- The Bonehead (worst start/sit): nobody, since no bench player outscored a starter they could have replaced');
    expect(sheet).not.toContain('benched  (0.0)');
  });

  it('has no season section without a leaderboard', () => {
    expect(factSheet(awards)).not.toContain('Season so far');
  });

  it('calls out this week\'s repeat winners only, not a team winning an award for the first time', () => {
    const sheet = factSheet(awards, leaderboard);
    expect(sheet).toContain('Season so far (Weeks 1–5)');
    expect(sheet).toContain('Jurong FC has now won The Corpse 3 times this season');
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

  const bonusAwards: Pick<WeekAwards, 'heartbreaker' | 'mercyRule' | 'oneManArmy'> = {
    heartbreaker: { team: 'Alpha', teamId: 1, score: 97, opponent: 'Bravo', opponentScore: 100, margin: 3 },
    mercyRule: { team: 'Charlie', teamId: 5, score: 150, opponent: 'Jurong FC', opponentScore: 85, margin: 65 },
    oneManArmy: { team: 'Delta', teamId: 3, player: 'Dak Prescott', points: 11, teamScore: 26, share: 11 / 26 },
  };

  it('lists the bonus awards someone won under their own heading', () => {
    const sheet = factSheet({ ...awards, ...bonusAwards });
    expect(sheet).toContain('Bonus awards this week (optional to mention):');
    expect(sheet).toContain('- Heartbreaker (closest loss, 5 pts or less): Alpha lost 97.0–100.0 to Bravo, by 3.0');
    expect(sheet).toContain('- Mercy Rule (biggest blowout, 60+ pts): Charlie beat Jurong FC 150.0–85.0, by 65.0');
    expect(sheet).toContain("- One-Man Army (one starter scored 30%+ of a winning team's points): Dak Prescott scored 11.0 of Delta's 26.0 pts (42%)");
  });

  it('leaves out a bonus award nobody won', () => {
    const sheet = factSheet({ ...awards, heartbreaker: bonusAwards.heartbreaker });
    expect(sheet).toContain('Heartbreaker');
    expect(sheet).not.toContain('Mercy Rule');
    expect(sheet).not.toContain('One-Man Army');
  });

  it('has no bonus heading when nobody won a bonus award', () => {
    expect(factSheet(awards)).not.toContain('Bonus awards');
  });

  it('calls out a repeat Heartbreaker, and skips the season check for a bonus award nobody won this week', () => {
    const repeatHeartbreak = {
      ...leaderboard,
      winsByTeamId: { ...leaderboard.winsByTeamId, heartbreaker: new Map([[1, 2]]) },
      leaders: { ...leaderboard.leaders, heartbreaker: { teams: ['Alpha'], count: 2 } },
    };
    const sheet = factSheet({ ...awards, heartbreaker: bonusAwards.heartbreaker }, repeatHeartbreak);
    expect(sheet).toContain('Alpha has now won Heartbreaker 2 times this season');
    expect(sheet).toContain('Season leader for Heartbreaker: Alpha with 2');
  });

  it('passes the code check without mentioning any bonus award, and with the One-Man Army percentage', () => {
    const sheet = factSheet({ ...awards, ...bonusAwards });
    expect(verifyDraft(`Bravo dropped 120.0! ${AWARD_NAMES}.`, sheet)).toEqual([]);
    expect(verifyDraft(`Dak Prescott was 42% of Delta. ${AWARD_NAMES}.`, sheet)).toEqual([]);
  });
});

const AWARD_NAMES = 'The Juggernaut, The Corpse, Baller of the Week, The Sleepwalker, The Bonehead, Backed Into It, Robbed';
const GOOD_DRAFT = `Bravo dropped 120.0! ${AWARD_NAMES}.`;
const BAD_DRAFT = `Bravo dropped 999.9! ${AWARD_NAMES}.`;
const APPROVED: Verdict = { approved: true, issues: [] };
const sheet = factSheet(awards);

function fakeAgents(drafts: string[], verdicts: Verdict[] = [APPROVED]): Mocked<Agents> {
  let writerCalls = 0;
  let checkerCalls = 0;
  return {
    analyst: vi.fn<Agents['analyst']>(async () => ['Bravo ran up the score']),
    writer: vi.fn<Agents['writer']>(async () => drafts[Math.min(writerCalls++, drafts.length - 1)]!),
    checker: vi.fn<Agents['checker']>(async () => verdicts[Math.min(checkerCalls++, verdicts.length - 1)]!),
  };
}

function fakeDependencies(agents: Agents): Mocked<RoastDependencies> {
  return { agents, legacy: vi.fn<RoastDependencies['legacy']>(async () => 'legacy roast'), log: vi.fn<RoastDependencies['log']>() } as Mocked<RoastDependencies>;
}

const options = (pipeline?: 'off' | 'shadow' | 'on') => ({ apiKey: 'k', model: 'm', pipeline });

describe('runPipeline', () => {
  it('approves the first draft when both checks pass', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBe(GOOD_DRAFT);
    expect(agents.writer).toHaveBeenCalledWith(sheet, ['Bravo ran up the score'], undefined);
    expect(result.trace).toBe('roast: analyst ok (1 storylines), draft 1 approved, 3 calls');
  });

  it('sends a draft with an invented number back to the writer without asking the checker', async () => {
    const agents = fakeAgents([BAD_DRAFT, GOOD_DRAFT]);
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBe(GOOD_DRAFT);
    expect(agents.checker).toHaveBeenCalledTimes(1);
    expect(agents.writer).toHaveBeenLastCalledWith(sheet, expect.any(Array), {
      draft: BAD_DRAFT,
      issues: ["The number 999.9 isn't in the fact sheet. Use a number from the sheet or cut it."],
    });
    expect(result.trace).toContain('draft 1 rejected (code: "The number 999.9 isn\'t in the fact sheet.');
  });

  it('revises after the checker rejects a draft', async () => {
    const agents = fakeAgents([GOOD_DRAFT], [{ approved: false, issues: ['Wrong team for The Corpse.'] }, APPROVED]);
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBe(GOOD_DRAFT);
    expect(agents.writer).toHaveBeenLastCalledWith(sheet, expect.any(Array), {
      draft: GOOD_DRAFT,
      issues: ['Wrong team for The Corpse.'],
    });
    expect(result.trace).toContain('draft 2 approved');
  });

  it(`gives up after ${MAX_ATTEMPTS} rejected drafts`, async () => {
    const agents = fakeAgents([BAD_DRAFT]);
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBeNull();
    expect(agents.writer).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result.trace).toContain('gave up');
  });

  it('writes without storylines when the analyst fails', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    agents.analyst.mockRejectedValueOnce(new Error('overloaded'));
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBe(GOOD_DRAFT);
    expect(agents.writer).toHaveBeenCalledWith(sheet, [], undefined);
    expect(result.trace).toContain('analyst failed (overloaded)');
  });

  it('moves on to the next attempt when the writer or checker fails', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    agents.writer.mockRejectedValueOnce(new Error('timeout'));
    agents.checker.mockRejectedValueOnce(new Error('overloaded'));
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBe(GOOD_DRAFT);
    expect(result.trace).toContain('draft 1 failed (timeout), draft 2 failed (overloaded), draft 3 approved');
  });

  it('gives up when every attempt fails', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    agents.writer.mockRejectedValue(new Error('down'));
    const result = await runPipeline(sheet, agents);
    expect(result.roast).toBeNull();
    expect(agents.writer).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(result.trace).toContain('gave up');
  });
});

describe('generateRoast', () => {
  it('off: makes only the single call', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    const dependencies = fakeDependencies(agents);
    expect(await generateRoast(awards, options('off'), undefined, dependencies)).toBe('legacy roast');
    expect(agents.analyst).not.toHaveBeenCalled();
    expect(agents.writer).not.toHaveBeenCalled();
  });

  it('shadow: sends the single-call roast and logs the approved pipeline roast', async () => {
    const dependencies = fakeDependencies(fakeAgents([GOOD_DRAFT]));
    expect(await generateRoast(awards, options('shadow'), undefined, dependencies)).toBe('legacy roast');
    await vi.waitFor(() => {
      expect(dependencies.log).toHaveBeenCalledWith(expect.stringContaining('[shadow] roast: analyst ok'));
      expect(dependencies.log).toHaveBeenCalledWith(`[shadow] Pipeline roast (not sent):\n${GOOD_DRAFT}`);
    });
  });

  it('labels the logs with the league', async () => {
    const dependencies = fakeDependencies(fakeAgents([GOOD_DRAFT]));
    await generateRoast(awards, { ...options('shadow'), league: 'Main League' }, undefined, dependencies);
    await vi.waitFor(() => expect(dependencies.log).toHaveBeenCalledWith(expect.stringMatching(/^\[Main League\] \[shadow\] roast: /)));
  });

  it('shadow: sends without waiting for the pipeline to finish', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    agents.analyst.mockReturnValue(new Promise<string[]>(() => {}));
    const dependencies = fakeDependencies(agents);
    expect(await generateRoast(awards, options('shadow'), undefined, dependencies)).toBe('legacy roast');
    expect(dependencies.log).not.toHaveBeenCalled();
  });

  it('shadow: still sends when the pipeline fails', async () => {
    const agents = fakeAgents([GOOD_DRAFT]);
    agents.writer.mockRejectedValue(new Error('down'));
    const dependencies = fakeDependencies(agents);
    expect(await generateRoast(awards, options('shadow'), undefined, dependencies)).toBe('legacy roast');
  });

  it('shadow: throws when the roast it would send fails', async () => {
    const dependencies = fakeDependencies(fakeAgents([GOOD_DRAFT]));
    dependencies.legacy.mockRejectedValue(new Error('api down'));
    await expect(generateRoast(awards, options('shadow'), undefined, dependencies)).rejects.toThrow('api down');
  });

  it('defaults to shadow', async () => {
    const dependencies = fakeDependencies(fakeAgents([GOOD_DRAFT]));
    expect(await generateRoast(awards, options(), undefined, dependencies)).toBe('legacy roast');
  });

  it('on: sends the pipeline roast', async () => {
    const dependencies = fakeDependencies(fakeAgents([GOOD_DRAFT]));
    expect(await generateRoast(awards, options('on'), undefined, dependencies)).toBe(GOOD_DRAFT);
    expect(dependencies.legacy).not.toHaveBeenCalled();
  });

  it('on: falls back to the single-call roast when every draft is rejected', async () => {
    const dependencies = fakeDependencies(fakeAgents([BAD_DRAFT]));
    expect(await generateRoast(awards, options('on'), undefined, dependencies)).toBe('legacy roast');
    expect(dependencies.log).toHaveBeenCalledWith('roast: falling back to the single-call roast');
  });
});

describe('parsePipelineMode', () => {
  it('reads the known modes and defaults to shadow when unset', () => {
    expect(parsePipelineMode('off')).toBe('off');
    expect(parsePipelineMode('on')).toBe('on');
    expect(parsePipelineMode('shadow')).toBe('shadow');
    expect(parsePipelineMode(undefined)).toBe('shadow');
    expect(parsePipelineMode('')).toBe('shadow');
  });

  it('warns and uses shadow for an unknown value', () => {
    const warn = vi.fn();
    expect(parsePipelineMode('yes', warn)).toBe('shadow');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown ROAST_PIPELINE "yes"'));
  });
});
