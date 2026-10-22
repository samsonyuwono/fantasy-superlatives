import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkLeagueAccess, EspnAccessError } from './espn.js';
import { espnCheckAlertContent, sendEspnCheckAlert, type CheckFailure, type FailureKind, type SecretFixes } from './emailer.js';
import { completedWeek, isInSeason } from './week.js';
import { required, githubRunUrl, setGithubOutput } from './env.js';
import {
  accountsToUpdate,
  parseLeaguesJson,
  parseLeagueSecretsJson,
  resolveEspnConfig,
  type LeagueConfig,
  type LeagueSecrets,
} from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = join(__dirname, '..');

/**
 * For the Monday check that ESPN still accepts each league's cookies before Tuesday's recap: the
 * leagues with a Weeks 1–14 recap due on the coming Tuesday, or all of them with `force` (`--force`).
 */
export function leaguesDueForCheck(leagues: LeagueConfig[], now: Date, force: boolean): LeagueConfig[] {
  if (force) return leagues;
  return leagues.filter((league) => isInSeason(completedWeek(league.seasonWeek1Tuesday, now)));
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

/** What to fix in LEAGUE_SECRETS_JSON for these failures. */
export function secretFixes(failures: CheckFailure[], secrets: Record<string, LeagueSecrets>): SecretFixes {
  const leagueIdsOfKind = (kind: FailureKind) =>
    failures.filter((failure) => failure.kind === kind).map((failure) => failure.league.id);
  return {
    accounts: accountsToUpdate([...leagueIdsOfKind('cookies'), ...leagueIdsOfKind('unclear')], secrets),
    missing: leagueIdsOfKind('missing-secret'),
  };
}

async function main(): Promise<void> {
  const commandLineArguments = process.argv.slice(2);
  const dryRun = commandLineArguments.includes('--dry-run');
  const force = commandLineArguments.includes('--force');

  const resendApiKey = required('RESEND_API_KEY');
  const ownerAlertEmail = required('OWNER_ALERT_EMAIL');
  const emailFrom = process.env.EMAIL_FROM || 'onboarding@resend.dev';

  const leagues = parseLeaguesJson(readFileSync(join(REPOSITORY_ROOT, 'leagues.json'), 'utf8'));
  const secrets = parseLeagueSecretsJson(required('LEAGUE_SECRETS_JSON'));

  const dueLeagues = leaguesDueForCheck(leagues, new Date(), force);
  if (dueLeagues.length === 0) {
    console.info('No league has a recap due this week. Nothing to check.');
    return;
  }

  const settledChecks = await Promise.allSettled(
    dueLeagues.map(async (league) => checkLeagueAccess(resolveEspnConfig(league, secrets))),
  );
  const failures: CheckFailure[] = settledChecks.flatMap((settlement, i) => {
    const league = dueLeagues[i]!;
    if (settlement.status === 'fulfilled') {
      console.info(`[${league.displayName}] ESPN access OK.`);
      return [];
    }
    const error = settlement.reason instanceof Error ? settlement.reason : new Error(String(settlement.reason));
    console.error(`[${league.displayName}] ESPN access failed:`, error.message);
    return [{ league, error, kind: classifyFailure(league, secrets, error) }];
  });

  if (failures.length > 0 && dryRun) {
    const { subject, text } = espnCheckAlertContent(failures, secretFixes(failures, secrets));
    console.info(`\n--- DRY RUN: the alert that would go to ${ownerAlertEmail} (not sending) ---`);
    console.info(`Subject: ${subject}\n\n${text}\n`);
  }

  if (failures.length > 0 && !dryRun) {
    const runUrl = githubRunUrl();
    const fixes = secretFixes(failures, secrets);
    await sendEspnCheckAlert({ apiKey: resendApiKey, from: emailFrom, ownerEmail: ownerAlertEmail, failures, fixes, runUrl });
    console.info(`Sent the ESPN check alert to ${ownerAlertEmail}.`);
    setGithubOutput('alerted', 'true');
  }

  console.info(`Done: ${dueLeagues.length - failures.length}/${dueLeagues.length} leagues passed.`);
  process.exitCode = failures.length > 0 ? 1 : 0;
}

const isRunDirectly = import.meta.url === `file://${process.argv[1]}`;
if (isRunDirectly) {
  main().catch((error) => {
    console.error('Cookie check failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
