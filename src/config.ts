import type { EspnConfig } from './espn.js';

export interface LeagueConfig {
  id: string;
  displayName: string;
  leagueId: number;
  seasonYear: number;
  seasonWeek1Tuesday: string;
  recipientEmails: string[];
  requiresAuth?: boolean;
}

export interface LeagueSecrets {
  espnS2: string;
  swid: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parseLeagueConfig(raw: unknown, index: number): LeagueConfig {
  const label = `leagues[${index}]`;
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${label} must be an object`);
  }
  const league = raw as Record<string, unknown>;

  if (!isNonEmptyString(league.id)) throw new Error(`${label}: missing or invalid "id"`);
  const id = league.id;

  if (!isNonEmptyString(league.displayName)) throw new Error(`League "${id}": missing or invalid "displayName"`);
  if (typeof league.leagueId !== 'number') throw new Error(`League "${id}": missing or invalid "leagueId"`);
  if (typeof league.seasonYear !== 'number') throw new Error(`League "${id}": missing or invalid "seasonYear"`);
  if (!isNonEmptyString(league.seasonWeek1Tuesday)) {
    throw new Error(`League "${id}": missing or invalid "seasonWeek1Tuesday"`);
  }
  if (
    !Array.isArray(league.recipientEmails) ||
    league.recipientEmails.length === 0 ||
    !league.recipientEmails.every(isNonEmptyString)
  ) {
    throw new Error(`League "${id}": "recipientEmails" must be a non-empty array of strings`);
  }
  if (league.requiresAuth !== undefined && typeof league.requiresAuth !== 'boolean') {
    throw new Error(`League "${id}": "requiresAuth" must be a boolean if present`);
  }

  return {
    id,
    displayName: league.displayName,
    leagueId: league.leagueId,
    seasonYear: league.seasonYear,
    seasonWeek1Tuesday: league.seasonWeek1Tuesday,
    recipientEmails: league.recipientEmails as string[],
    requiresAuth: league.requiresAuth as boolean | undefined,
  };
}

/** Parse and validate `leagues.json`'s contents. Throws with a clear, league-scoped message. */
export function parseLeaguesJson(raw: string): LeagueConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`leagues.json is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }

  const rawLeagues = (parsed as { leagues?: unknown })?.leagues;
  if (!Array.isArray(rawLeagues)) {
    throw new Error('leagues.json must have a top-level "leagues" array');
  }

  const leagues = rawLeagues.map((rawLeague, index) => parseLeagueConfig(rawLeague, index));

  const seenIds = new Set<string>();
  for (const league of leagues) {
    if (seenIds.has(league.id)) throw new Error(`Duplicate league id in leagues.json: "${league.id}"`);
    seenIds.add(league.id);
  }

  return leagues;
}

/**
 * Parse the `LEAGUE_SECRETS_JSON` secret: one GitHub Secret holding every league's ESPN
 * cookies, as an object keyed by league id.
 */
export function parseLeagueSecretsJson(raw: string): Record<string, LeagueSecrets> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`LEAGUE_SECRETS_JSON is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LEAGUE_SECRETS_JSON must be a JSON object keyed by league id');
  }

  const secretsByLeagueId: Record<string, LeagueSecrets> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const cookies = value as Record<string, unknown>;
    if (!isNonEmptyString(cookies?.espnS2) || !isNonEmptyString(cookies?.swid)) {
      throw new Error(`LEAGUE_SECRETS_JSON["${id}"] must have string "espnS2" and "swid"`);
    }
    secretsByLeagueId[id] = { espnS2: cookies.espnS2, swid: cookies.swid };
  }
  return secretsByLeagueId;
}

/**
 * Resolve one league's ESPN cookies from the secrets map. `requiresAuth` defaults to true;
 * only a public ESPN league, which needs no cookies, sets it to false. Throws a league-named
 * error if auth is required and no matching secret entry exists — a missing entry should be
 * a loud config error, not a silent unauthenticated fetch against a private league.
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
