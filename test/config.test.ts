import { describe, it, expect } from 'vitest';
import { parseLeaguesJson, parseLeagueSecretsJson, resolveEspnConfig } from '../src/config.js';

const VALID_LEAGUE = {
  id: 'main',
  displayName: 'Main League',
  leagueId: 123456,
  seasonYear: 2026,
  seasonWeek1Tuesday: '2026-09-15',
  recipientEmails: ['owner@example.com'],
};

describe('parseLeaguesJson', () => {
  it('parses a valid single-league file', () => {
    const leagues = parseLeaguesJson(JSON.stringify({ leagues: [VALID_LEAGUE] }));
    expect(leagues).toEqual([VALID_LEAGUE]);
  });

  it('accepts an empty leagues array', () => {
    expect(parseLeaguesJson(JSON.stringify({ leagues: [] }))).toEqual([]);
  });

  it('throws naming the league id when a required field is missing', () => {
    const bad = { ...VALID_LEAGUE, displayName: undefined };
    expect(() => parseLeaguesJson(JSON.stringify({ leagues: [bad] }))).toThrowError(/League "main"/);
  });

  it('throws on duplicate ids', () => {
    expect(() => parseLeaguesJson(JSON.stringify({ leagues: [VALID_LEAGUE, VALID_LEAGUE] }))).toThrowError(
      /Duplicate league id/,
    );
  });

  it('throws on malformed JSON', () => {
    expect(() => parseLeaguesJson('{not json')).toThrowError(/not valid JSON/);
  });

  it('throws when the top-level "leagues" array is missing', () => {
    expect(() => parseLeaguesJson(JSON.stringify({}))).toThrowError(/"leagues" array/);
  });
});

describe('parseLeagueSecretsJson', () => {
  it('parses a valid secrets object', () => {
    const secrets = parseLeagueSecretsJson(JSON.stringify({ main: { espnS2: 'a', swid: 'b' } }));
    expect(secrets).toEqual({ main: { espnS2: 'a', swid: 'b' } });
  });

  it('throws a clear error on malformed JSON', () => {
    expect(() => parseLeagueSecretsJson('{not json')).toThrowError(/not valid JSON/);
  });

  it('throws when an entry is missing espnS2/swid', () => {
    expect(() => parseLeagueSecretsJson(JSON.stringify({ main: { espnS2: 'a' } }))).toThrowError(/"main"/);
  });
});

describe('resolveEspnConfig', () => {
  it('merges a present secret entry into the EspnConfig', () => {
    const cfg = resolveEspnConfig(VALID_LEAGUE, { main: { espnS2: 'a', swid: 'b' } });
    expect(cfg).toEqual({ leagueId: 123456, seasonYear: 2026, espnS2: 'a', swid: 'b' });
  });

  it('throws naming the league when auth is required but no secret entry exists', () => {
    expect(() => resolveEspnConfig(VALID_LEAGUE, {})).toThrowError(/League "main"/);
  });

  it('succeeds with no cookies when requiresAuth is false and no secret entry exists', () => {
    const publicLeague = { ...VALID_LEAGUE, requiresAuth: false };
    const cfg = resolveEspnConfig(publicLeague, {});
    expect(cfg).toEqual({ leagueId: 123456, seasonYear: 2026 });
  });
});
