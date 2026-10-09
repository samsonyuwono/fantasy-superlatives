import { describe, it, expect } from 'vitest';
import { cookieFixesFor, summarize, type RecapResult } from '../src/recap.js';

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

describe('cookieFixesFor', () => {
  const secrets = {
    main: { espnS2: 'a', swid: '{ME}' },
    second: { espnS2: 'b', swid: '{ME}' },
  };
  const httpError = (status: number) =>
    Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

  it('lists every entry on the account when ESPN rejects the cookies', () => {
    expect(cookieFixesFor('main', httpError(401), secrets)).toEqual({ accounts: [['main', 'second']], missing: [] });
    expect(cookieFixesFor('second', httpError(403), secrets)).toEqual({ accounts: [['main', 'second']], missing: [] });
  });

  it('gives no cookie fixes for other failures', () => {
    expect(cookieFixesFor('main', httpError(503), secrets)).toBeUndefined();
    expect(cookieFixesFor('main', new Error('No matchups returned for Week 5'), secrets)).toBeUndefined();
  });

  it('gives no cookie fixes for a league without a secret entry', () => {
    expect(cookieFixesFor('public', httpError(401), secrets)).toBeUndefined();
  });
});
