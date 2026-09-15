import { describe, it, expect } from 'vitest';
import { teamName, shouldSetCookies } from '../src/espn.js';

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
