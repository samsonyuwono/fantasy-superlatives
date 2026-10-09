import { describe, it, expect } from 'vitest';
import { leaguesDueForCheck, classifyFailure, accountsToUpdate } from '../src/cookie-check.js';
import { espnCheckAlertContent, type CheckFailure } from '../src/emailer.js';
import { EspnAccessError } from '../src/espn.js';
import type { LeagueConfig } from '../src/config.js';

const league = (id: string, seasonWeek1Tuesday: string): LeagueConfig => ({
  id,
  displayName: id,
  leagueId: 1,
  seasonYear: 2026,
  seasonWeek1Tuesday,
  recipientEmails: ['a@example.com'],
});

// Week 1's recap goes out Tuesday 2026-09-15, so Week N's goes out 7·(N−1) days later.
const leagues = [league('main', '2026-09-15')];
const monday = (iso: string) => new Date(`${iso}T16:00:00Z`);

describe('leaguesDueForCheck', () => {
  it('checks on the Monday before the Week 1 recap', () => {
    expect(leaguesDueForCheck(leagues, monday('2026-09-14'), false)).toEqual(leagues);
  });

  it('checks on the Monday before the Week 14 recap', () => {
    expect(leaguesDueForCheck(leagues, monday('2026-12-14'), false)).toEqual(leagues);
  });

  it('skips the Monday before Week 15, which has no recap', () => {
    expect(leaguesDueForCheck(leagues, monday('2026-12-21'), false)).toEqual([]);
  });

  it('skips the preseason', () => {
    expect(leaguesDueForCheck(leagues, monday('2026-09-07'), false)).toEqual([]);
  });

  it('only returns the leagues that are in season', () => {
    const mixed = [league('main', '2026-09-15'), league('old', '2025-09-09')];
    expect(leaguesDueForCheck(mixed, monday('2026-09-21'), false).map((l) => l.id)).toEqual(['main']);
  });

  it('checks every league with force, even out of season', () => {
    expect(leaguesDueForCheck(leagues, monday('2026-07-06'), true)).toEqual(leagues);
  });
});

const secrets = {
  main: { espnS2: 'mine-new', swid: '{ME}' },
  second: { espnS2: 'mine-old', swid: '{me}' },
  friend: { espnS2: 'theirs', swid: '{THEM}' },
};

describe('classifyFailure', () => {
  const unauthorized = new EspnAccessError('ESPN rejected the request: 401', 401);

  it('calls a 401 or 403 a cookie problem', () => {
    expect(classifyFailure(league('main', '2026-09-15'), secrets, unauthorized)).toBe('cookies');
    expect(classifyFailure(league('main', '2026-09-15'), secrets, new EspnAccessError('403', 403))).toBe('cookies');
  });

  it('does not blame the cookies for a server error, an empty response, or a non-ESPN error', () => {
    const main = league('main', '2026-09-15');
    expect(classifyFailure(main, secrets, new EspnAccessError('ESPN rejected the request: 503', 503))).toBe('other');
    expect(classifyFailure(main, secrets, new EspnAccessError('ESPN returned no settings'))).toBe('other');
    expect(classifyFailure(main, secrets, new Error('boom'))).toBe('other');
  });

  it('flags a private league with no secret entry as missing, whatever the error', () => {
    expect(classifyFailure(league('new', '2026-09-15'), secrets, new Error('requires auth'))).toBe('missing-secret');
  });

  it('does not ask for cookies for a public league', () => {
    const publicLeague = { ...league('open', '2026-09-15'), requiresAuth: false };
    expect(classifyFailure(publicLeague, secrets, unauthorized)).toBe('other');
  });
});

describe('accountsToUpdate', () => {
  it('groups entries by SWID, even when their espnS2 values differ', () => {
    expect(accountsToUpdate(['main'], secrets)).toEqual([['main', 'second']]);
  });

  it('keeps a different account in its own group', () => {
    expect(accountsToUpdate(['friend'], secrets)).toEqual([['friend']]);
  });

  it('lists each account once when several of its leagues fail', () => {
    expect(accountsToUpdate(['second', 'main', 'friend'], secrets)).toEqual([['main', 'second'], ['friend']]);
  });

  it('skips ids with no secret entry', () => {
    expect(accountsToUpdate(['new'], secrets)).toEqual([]);
  });
});

describe('espnCheckAlertContent', () => {
  const main = { id: 'main', displayName: 'Main League' };
  const second = { id: 'second', displayName: 'Chicken Rice & Chopped Cheese' };
  const cookieFailure = (l: typeof main): CheckFailure => ({ league: l, error: new Error('status code 401'), kind: 'cookies' });
  const sharedAccount = { accounts: [['main', 'second']], missing: [] };

  it('calls it a cookie problem when every failure is one', () => {
    const { subject } = espnCheckAlertContent([cookieFailure(main), cookieFailure(second)], sharedAccount);
    expect(subject).toBe('⚠️ ESPN cookies may have expired (Main League, Chicken Rice & Chopped Cheese)');
  });

  it('says the leagues on one account all need the new cookies, in both versions', () => {
    const { text, html } = espnCheckAlertContent([cookieFailure(main)], sharedAccount);
    for (const body of [text, html]) {
      expect(body).toContain('Update espnS2 and swid for main, second. They use the same ESPN account');
      expect(body).toContain('gh secret set LEAGUE_SECRETS_JSON');
      expect(body).toContain('include every league');
    }
  });

  it('asks for a new entry when one is missing', () => {
    const missing: CheckFailure = { league: { id: 'new', displayName: 'New' }, error: new Error('no entry'), kind: 'missing-secret' };
    const { subject, text } = espnCheckAlertContent([missing], { accounts: [], missing: ['new'] });
    expect(subject).toBe('⚠️ ESPN check failed (New)');
    expect(text).toContain('Add an entry for new');
    expect(text).not.toContain('Update espnS2');
  });

  it('gives no cookie steps when nothing is a cookie problem', () => {
    const down: CheckFailure = { league: main, error: new Error('status code 503'), kind: 'other' };
    const { subject, text } = espnCheckAlertContent([down], { accounts: [], missing: [] });
    expect(subject).toBe('⚠️ ESPN check failed (Main League)');
    expect(text).toContain('NOT A COOKIE PROBLEM');
    expect(text).not.toContain('HOW TO FIX THE COOKIES');
  });

  it('shows both sections when the failures are mixed', () => {
    const down: CheckFailure = { league: second, error: new Error('status code 503'), kind: 'other' };
    const { text } = espnCheckAlertContent([cookieFailure(main), down], { accounts: [['main']], missing: [] });
    expect(text).toContain('HOW TO FIX THE COOKIES');
    expect(text).toContain('NOT A COOKIE PROBLEM');
  });

  it('escapes league names and errors in the HTML', () => {
    const { html } = espnCheckAlertContent([cookieFailure(second)], { accounts: [['second']], missing: [] });
    expect(html).toContain('Chicken Rice &amp; Chopped Cheese');
    expect(html).not.toContain('Rice & Chopped');
  });

  it('links the run only when there is one', () => {
    expect(espnCheckAlertContent([cookieFailure(main)], sharedAccount).text).not.toContain('View the run');
    const { text, html } = espnCheckAlertContent([cookieFailure(main)], sharedAccount, 'https://github.com/x/y/actions/runs/1');
    expect(text).toContain('View the run: https://github.com/x/y/actions/runs/1');
    expect(html).toContain('href="https://github.com/x/y/actions/runs/1"');
  });
});
