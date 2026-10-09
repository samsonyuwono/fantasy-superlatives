/**
 * Multi-league config: parses the committed `leagues.json` (non-secret) and the
 * `LEAGUE_SECRETS_JSON` env var (one GitHub Secret holding every league's ESPN cookies,
 * keyed by league id) and resolves the two into the `EspnConfig` each league's fetch needs.
 */
import type { EspnConfig } from './espn.js';

export interface LeagueConfig {
  id: string;
  displayName: string;
  leagueId: number;
  seasonYear: number;
  seasonWeek1Tuesday: string;
  recipientEmails: string[];
  /** Public ESPN leagues need no cookies at all. Defaults to true. */
  requiresAuth?: boolean;
}

export interface LeagueSecrets {
  espnS2: string;
  swid: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function parseLeagueConfig(raw: unknown, index: number): LeagueConfig {
  const label = `leagues[${index}]`;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${label} must be an object`);
  }
  const l = raw as Record<string, unknown>;

  if (!isNonEmptyString(l.id)) throw new Error(`${label}: missing or invalid "id"`);
  const id = l.id;

  if (!isNonEmptyString(l.displayName)) throw new Error(`League "${id}": missing or invalid "displayName"`);
  if (typeof l.leagueId !== 'number') throw new Error(`League "${id}": missing or invalid "leagueId"`);
  if (typeof l.seasonYear !== 'number') throw new Error(`League "${id}": missing or invalid "seasonYear"`);
  if (!isNonEmptyString(l.seasonWeek1Tuesday)) {
    throw new Error(`League "${id}": missing or invalid "seasonWeek1Tuesday"`);
  }
  if (!Array.isArray(l.recipientEmails) || l.recipientEmails.length === 0 || !l.recipientEmails.every(isNonEmptyString)) {
    throw new Error(`League "${id}": "recipientEmails" must be a non-empty array of strings`);
  }
  if (l.requiresAuth !== undefined && typeof l.requiresAuth !== 'boolean') {
    throw new Error(`League "${id}": "requiresAuth" must be a boolean if present`);
  }

  return {
    id,
    displayName: l.displayName,
    leagueId: l.leagueId,
    seasonYear: l.seasonYear,
    seasonWeek1Tuesday: l.seasonWeek1Tuesday,
    recipientEmails: l.recipientEmails as string[],
    requiresAuth: l.requiresAuth as boolean | undefined,
  };
}

/** Parse and validate `leagues.json`'s contents. Throws with a clear, league-scoped message. */
export function parseLeaguesJson(raw: string): LeagueConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`leagues.json is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  const leaguesRaw = (parsed as { leagues?: unknown })?.leagues;
  if (!Array.isArray(leaguesRaw)) {
    throw new Error('leagues.json must have a top-level "leagues" array');
  }

  const leagues = leaguesRaw.map((l, i) => parseLeagueConfig(l, i));

  const seen = new Set<string>();
  for (const l of leagues) {
    if (seen.has(l.id)) throw new Error(`Duplicate league id in leagues.json: "${l.id}"`);
    seen.add(l.id);
  }

  return leagues;
}

/** Parse the `LEAGUE_SECRETS_JSON` secret: an object keyed by league id. */
export function parseLeagueSecretsJson(raw: string): Record<string, LeagueSecrets> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`LEAGUE_SECRETS_JSON is not valid JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LEAGUE_SECRETS_JSON must be a JSON object keyed by league id');
  }

  const result: Record<string, LeagueSecrets> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const v = value as Record<string, unknown>;
    if (!isNonEmptyString(v?.espnS2) || !isNonEmptyString(v?.swid)) {
      throw new Error(`LEAGUE_SECRETS_JSON["${id}"] must have string "espnS2" and "swid"`);
    }
    result[id] = { espnS2: v.espnS2, swid: v.swid };
  }
  return result;
}

/**
 * Resolve one league's ESPN cookies from the secrets map. Throws a league-named error if
 * auth is required (the default) and no matching secret entry exists — a missing entry
 * should be a loud config error, not a silent unauthenticated fetch against a private league.
 */
export function resolveEspnConfig(league: LeagueConfig, secrets: Record<string, LeagueSecrets>): EspnConfig {
  const entry = secrets[league.id];
  const requiresAuth = league.requiresAuth !== false;

  if (!entry) {
    if (requiresAuth) {
      throw new Error(
        `League "${league.id}" requires auth but has no entry in LEAGUE_SECRETS_JSON. ` +
          `Set requiresAuth: false in leagues.json if this is a public league.`,
      );
    }
    return { leagueId: league.leagueId, seasonYear: league.seasonYear };
  }

  return {
    leagueId: league.leagueId,
    seasonYear: league.seasonYear,
    espnS2: entry.espnS2,
    swid: entry.swid,
  };
}

/**
 * Every secret entry to refresh, grouped by ESPN account. SWID identifies the account and stays
 * the same across logins, so it finds entries that share a login even if their espnS2 differ.
 */
export function accountsToUpdate(failedIds: string[], secrets: Record<string, LeagueSecrets>): string[][] {
  const swidOf = (id: string) => secrets[id]?.swid.toUpperCase();
  const swids = [...new Set(failedIds.map(swidOf).filter((swid): swid is string => swid !== undefined))];
  return swids.map((swid) => Object.keys(secrets).filter((id) => swidOf(id) === swid));
}
