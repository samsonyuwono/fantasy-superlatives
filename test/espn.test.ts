import { describe, it, expect, vi } from 'vitest';
import { teamName, shouldSetCookies, lineupSlotsFromCounts, mapInBatches, withRetry, leagueFetcher, checkLeagueAccess, httpStatus, EspnAccessError } from '../src/espn.js';

const calls = vi.hoisted(() => ({
  boxscores: [] as number[],
  teams: [] as number[],
  leagueInfo: 'ok' as 'ok' | 401 | 503 | 'empty',
}));
vi.mock('espn-fantasy-football-api/node', () => ({
  default: {
    Client: class {
      setCookies() {}
      async getLeagueInfo() {
        if (typeof calls.leagueInfo === 'number') {
          const status = calls.leagueInfo;
          throw Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
        }
        if (calls.leagueInfo === 'empty') return {};
        return { rosterSettings: { lineupPositionCount: { QB: 1 } } };
      }
      async getTeamsAtWeek({ scoringPeriodId }: { scoringPeriodId: number }) {
        calls.teams.push(scoringPeriodId);
        return [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Bravo' }];
      }
      async getBoxscoreForWeek({ scoringPeriodId }: { scoringPeriodId: number }) {
        calls.boxscores.push(scoringPeriodId);
        return [{ homeTeamId: 1, awayTeamId: 2, homeScore: 10, awayScore: 20, homeRoster: [], awayRoster: [] }];
      }
    },
  },
}));

describe('teamName', () => {
  it('collapses internal runs of whitespace to a single space', () => {
    expect(teamName({ name: 'Tea  Baggers' })).toBe('Tea Baggers');
  });

  it('trims leading/trailing whitespace', () => {
    expect(teamName({ name: '  Supreme Leader  ' })).toBe('Supreme Leader');
  });

  it('falls back to the abbreviation when the name is empty', () => {
    expect(teamName({ name: '   ', abbreviation: 'TB' })).toBe('TB');
  });

  it('falls back to Team <id> when nothing else is available', () => {
    expect(teamName({ id: 7 })).toBe('Team 7');
  });
});

describe('shouldSetCookies', () => {
  it('is true when both espnS2 and swid are present', () => {
    expect(shouldSetCookies({ leagueId: 1, seasonYear: 2026, espnS2: 'a', swid: 'b' })).toBe(true);
  });

  it('is false for a public league with no cookies', () => {
    expect(shouldSetCookies({ leagueId: 1, seasonYear: 2026 })).toBe(false);
  });

  it('is false when only one of the pair is present', () => {
    expect(shouldSetCookies({ leagueId: 1, seasonYear: 2026, espnS2: 'a' })).toBe(false);
  });
});

describe('lineupSlotsFromCounts', () => {
  it('expands slot counts into one entry per starting slot', () => {
    expect(lineupSlotsFromCounts({ QB: 1, RB: 2, 'RB/WR/TE': 2, 'D/ST': 1 })).toEqual([
      'QB',
      'RB',
      'RB',
      'RB/WR/TE',
      'RB/WR/TE',
      'D/ST',
    ]);
  });

  it('drops bench, IR, and unused (zero-count) slots', () => {
    expect(lineupSlotsFromCounts({ QB: 1, K: 0, Bench: 7, IR: 1 })).toEqual(['QB']);
  });

  it('returns undefined when there are no settings to read', () => {
    expect(lineupSlotsFromCounts(undefined)).toBeUndefined();
    expect(lineupSlotsFromCounts({ Bench: 7 })).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('tries once more after a failure', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error('ESPN hiccup');
      return 'ok';
    }, 0);
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the second failure', async () => {
    let calls = 0;
    const failing = () => {
      calls += 1;
      return Promise.reject(new Error(`fail ${calls}`));
    };
    await expect(withRetry(failing, 0)).rejects.toThrow('fail 2');
    expect(calls).toBe(2);
  });
});

describe('mapInBatches', () => {
  it('keeps the input order and never runs more than the batch size at once', async () => {
    let running = 0;
    let maxRunning = 0;
    const result = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60, 70]);
    expect(maxRunning).toBe(3);
  });
});

describe('leagueFetcher', () => {
  it('fetches team names for this week but not for earlier weeks', async () => {
    calls.boxscores.length = 0;
    calls.teams.length = 0;
    const espn = leagueFetcher({ leagueId: 1, seasonYear: 2026 });

    const current = await espn.week(4);
    const earlier = await espn.earlierWeeks([1, 2, 3]);

    expect(calls.boxscores.sort()).toEqual([1, 2, 3, 4]);
    expect(calls.teams).toEqual([4]);
    expect(current.matchups[0]!.home.name).toBe('Alpha');
    expect(earlier.map((w) => w.week)).toEqual([1, 2, 3]);
    expect(earlier[0]!.matchups[0]!.home.name).toBe('Team 1');
    expect(earlier[0]!.matchups[0]!.home.lineupSlots).toEqual(['QB']);
  });
});

describe('httpStatus', () => {
  it('reads the status from an axios-style error', () => {
    expect(httpStatus(Object.assign(new Error('x'), { response: { status: 401 } }))).toBe(401);
  });

  it('returns undefined when there is no response status', () => {
    expect(httpStatus(new Error('network down'))).toBeUndefined();
    expect(httpStatus({ response: { status: '401' } })).toBeUndefined();
    expect(httpStatus(null)).toBeUndefined();
  });
});

describe('checkLeagueAccess', () => {
  const cfg = { leagueId: 123, seasonYear: 2026, espnS2: 's2', swid: '{swid}' };
  const failure = async () => {
    try {
      await checkLeagueAccess(cfg);
    } catch (err) {
      return err;
    } finally {
      calls.leagueInfo = 'ok';
    }
    throw new Error('expected checkLeagueAccess to reject');
  };

  it('resolves when ESPN returns the league settings', async () => {
    calls.leagueInfo = 'ok';
    await expect(checkLeagueAccess(cfg)).resolves.toBeUndefined();
  });

  it('marks a 401 as an auth failure, with a cookie hint', async () => {
    calls.leagueInfo = 401;
    const err = await failure();
    expect(err).toBeInstanceOf(EspnAccessError);
    expect(err).toMatchObject({ status: 401, isAuthFailure: true });
    expect(String(err)).toMatch(/league 123.*401.*cookies may have expired/);
  });

  it('does not blame the cookies for a server error', async () => {
    calls.leagueInfo = 503;
    const err = await failure();
    expect(err).toMatchObject({ status: 503, isAuthFailure: false });
    expect(String(err)).not.toContain('cookies');
  });

  it('rejects without a status when ESPN returns no settings', async () => {
    calls.leagueInfo = 'empty';
    const err = await failure();
    expect(err).toMatchObject({ status: undefined, isAuthFailure: false });
    expect(String(err)).toMatch(/no settings for league 123/);
  });
});
