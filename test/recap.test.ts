import { describe, it, expect } from 'vitest';
import { summarize, type RecapResult } from '../src/recap.js';

describe('summarize', () => {
  it('reports no failures and exit code 0 when everything sent or skipped', () => {
    const results: RecapResult[] = [
      { leagueId: 'a', status: 'sent' },
      { leagueId: 'b', status: 'skipped' },
    ];
    expect(summarize(results)).toEqual({ failed: [], exitCode: 0 });
  });

  it('collects failed results and exit code 1 when any league fails', () => {
    const failure: RecapResult = { leagueId: 'b', status: 'failed', error: new Error('boom') };
    const results: RecapResult[] = [{ leagueId: 'a', status: 'sent' }, failure];
    expect(summarize(results)).toEqual({ failed: [failure], exitCode: 1 });
  });
});
