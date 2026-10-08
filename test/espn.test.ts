import { describe, it, expect } from 'vitest';
import { teamName, shouldSetCookies, lineupSlotsFromCounts, mapInBatches, withRetry } from '../src/espn.js';

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
