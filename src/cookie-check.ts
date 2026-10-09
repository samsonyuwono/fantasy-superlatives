/**
 * Monday check: confirm ESPN still accepts each league's cookies before Tuesday's recap, and
 * email OWNER_ALERT_EMAIL once, listing every league that failed.
 *
 * Usage:
 *   tsx src/cookie-check.ts             # check leagues whose next Tuesday is a Weeks 1–14 send
 *   tsx src/cookie-check.ts --force     # check every league, in season or not
 *   tsx src/cookie-check.ts --dry-run   # log the results without emailing
 */
import 'dotenv/config';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkLeagueAccess, EspnAccessError } from './espn.js';
import { sendEspnCheckAlert, type CheckFailure, type FailureKind, type SecretFixes } from './emailer.js';
import { completedWeek, isInSeason } from './week.js';
import { parseLeaguesJson, parseLeagueSecretsJson, resolveEspnConfig, type LeagueConfig, type LeagueSecrets } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

/** Leagues with a recap due on the coming Tuesday (or all of them with `force`). */
export function leaguesDueForCheck(leagues: LeagueConfig[], now: Date, force: boolean): LeagueConfig[] {
  if (force) return leagues;
  return leagues.filter((l) => isInSeason(completedWeek(l.seasonWeek1Tuesday, now)));
}

/**
 * Why a league failed: no secret entry when it needs one, ESPN rejecting its cookies (401/403),
 * ESPN answering with something unreadable (which may be the cookies), or anything else, such
 * as ESPN being unreachable or a wrong league ID.
 */
export function classifyFailure(league: LeagueConfig, secrets: Record<string, LeagueSecrets>, error: Error): FailureKind {
  if (!secrets[league.id]) return league.requiresAuth === false ? 'other' : 'missing-secret';
  if (!(error instanceof EspnAccessError)) return 'other';
  if (error.isAuthFailure) return 'cookies';
  return error.failure === 'unreadable' ? 'unclear' : 'other';
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

/** What to fix in LEAGUE_SECRETS_JSON for these failures. */
export function secretFixes(failures: CheckFailure[], secrets: Record<string, LeagueSecrets>): SecretFixes {
  const idsOf = (kind: FailureKind) => failures.filter((f) => f.kind === kind).map((f) => f.league.id);
  return {
    accounts: accountsToUpdate([...idsOf('cookies'), ...idsOf('unclear')], secrets),
    missing: idsOf('missing-secret'),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force = argv.includes('--force');

  const resendApiKey = required('RESEND_API_KEY');
  const ownerAlertEmail = required('OWNER_ALERT_EMAIL');
  const emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  const leagues = parseLeaguesJson(readFileSync(join(REPO_ROOT, 'leagues.json'), 'utf8'));
  const secrets = parseLeagueSecretsJson(required('LEAGUE_SECRETS_JSON'));

  const due = leaguesDueForCheck(leagues, new Date(), force);
  if (due.length === 0) {
    console.info('No league has a recap due this week. Nothing to check.');
    return;
  }

  const settled = await Promise.allSettled(due.map(async (l) => checkLeagueAccess(resolveEspnConfig(l, secrets))));
  const failures: CheckFailure[] = settled.flatMap((s, i) => {
    const league = due[i]!;
    if (s.status === 'fulfilled') {
      console.info(`[${league.displayName}] ESPN access OK.`);
      return [];
    }
    const error = s.reason instanceof Error ? s.reason : new Error(String(s.reason));
    console.error(`[${league.displayName}] ESPN access failed:`, error.message);
    return [{ league, error, kind: classifyFailure(league, secrets, error) }];
  });

  if (failures.length > 0 && !dryRun) {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;
    const fixes = secretFixes(failures, secrets);
    await sendEspnCheckAlert({ apiKey: resendApiKey, from: emailFrom, ownerEmail: ownerAlertEmail, failures, fixes, runUrl });
    console.info(`Sent the ESPN check alert to ${ownerAlertEmail}.`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'alerted=true\n');
  }

  console.info(`Done: ${due.length - failures.length}/${due.length} leagues passed.`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Cookie check failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
