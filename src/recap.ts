/**
 * Weekly entrypoint: for every league in `leagues.json`, determine the just-completed NFL
 * week, fetch it from ESPN, compute the superlatives, have Claude write the roast, then email
 * it (or print it with --dry-run). Each league runs independently — one league's failure never
 * blocks another's email — and the owner gets a failure alert per failed league.
 *
 * Usage:
 *   tsx src/recap.ts               # normal weekly run (honours the Weeks 1–14 gate)
 *   tsx src/recap.ts --week 5      # force a specific week (bypasses the gate)
 *   tsx src/recap.ts --dry-run     # print each league's email to stdout instead of sending
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeAwards } from './awards.js';
import { fetchWeek, fetchWeeks } from './espn.js';
import { buildLeaderboard, type SeasonLeaderboard } from './leaderboard.js';
import { generateRoast } from './roast.js';
import { formatEmailBody, formatSubject } from './format.js';
import { sendRecap, sendFailureAlert, sendLeaderboardSkippedAlert } from './emailer.js';
import { completedWeek, isInSeason } from './week.js';
import { parseLeaguesJson, parseLeagueSecretsJson, resolveEspnConfig, type LeagueConfig, type LeagueSecrets } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

interface Args {
  week?: number;
  dryRun: boolean;
}

interface SharedConfig {
  anthropicApiKey: string;
  anthropicModel: string;
  resendApiKey: string;
  emailFrom: string;
  ownerAlertEmail: string;
}

export interface RecapResult {
  leagueId: string;
  status: 'sent' | 'skipped' | 'failed';
  error?: Error;
  leaderboardError?: Error;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--week') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value)) throw new Error('--week requires an integer, e.g. --week 5');
      args.week = value;
    }
  }
  return args;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function loadSharedConfig(): SharedConfig {
  return {
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    resendApiKey: required('RESEND_API_KEY'),
    emailFrom: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    ownerAlertEmail: required('OWNER_ALERT_EMAIL'),
  };
}

/** Run the full pipeline for one league. Never throws — failures are reported in the result. */
async function runLeagueRecap(
  league: LeagueConfig,
  secrets: Record<string, LeagueSecrets>,
  shared: SharedConfig,
  args: Args,
): Promise<RecapResult> {
  try {
    const week = args.week ?? completedWeek(league.seasonWeek1Tuesday, new Date());

    if (args.week === undefined && !isInSeason(week)) {
      console.log(`[${league.id}] Week ${week} is outside the regular season (Weeks 1–14). Nothing to send.`);
      return { leagueId: league.id, status: 'skipped' };
    }

    console.log(`[${league.id}] Building the Week ${week} recap...`);
    const espnConfig = resolveEspnConfig(league, secrets);
    const { matchups } = await fetchWeek(espnConfig, week);
    if (matchups.length === 0) {
      throw new Error(`No matchups returned for Week ${week} — check the league ID, season, and cookies.`);
    }
    console.log(`[${league.id}] Fetched ${matchups.length} matchups for Week ${week} of ${league.seasonYear}.`);

    const teams = matchups.flatMap((m) => [m.home, m.away]);
    if (teams.every((t) => t.score === 0)) {
      throw new Error(
        `Week ${week} of season ${league.seasonYear} has no scores yet (every team is 0.0). ` +
          `This usually means that season/week hasn't been played. To test now, point this league ` +
          `at a completed season (e.g. 2025) in leagues.json.`,
      );
    }

    const awards = computeAwards(matchups, week);

    let leaderboard: SeasonLeaderboard | undefined;
    let leaderboardError: Error | undefined;
    if (week > 1) {
      try {
        const pastWeeks = Array.from({ length: week - 1 }, (_, i) => i + 1);
        const past = await fetchWeeks(espnConfig, pastWeeks);
        leaderboard = buildLeaderboard([...past, { week, matchups }]);
      } catch (err) {
        leaderboardError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[${league.id}] Sending without the season leaderboard:`, leaderboardError.message);
      }
    }

    const roast = await generateRoast(
      awards,
      { apiKey: shared.anthropicApiKey, model: shared.anthropicModel },
      leaderboard,
    );

    const subject = formatSubject(week, league.displayName);
    const body = formatEmailBody(awards, roast, leaderboard);

    if (args.dryRun) {
      console.log(`\n--- DRY RUN: ${league.displayName} (not sending) ---`);
      console.log(`Subject: ${subject}\n`);
      console.log(body);
      return { leagueId: league.id, status: 'skipped' };
    }

    await sendRecap({
      apiKey: shared.resendApiKey,
      from: shared.emailFrom,
      to: league.recipientEmails,
      subject,
      text: body,
    });
    console.log(`[${league.id}] Sent the Week ${week} recap to ${league.recipientEmails.join(', ')}.`);
    return { leagueId: league.id, status: 'sent', leaderboardError };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[${league.id}] Recap failed:`, error.message);
    return { leagueId: league.id, status: 'failed', error };
  }
}

/** Pure summary of a batch of league results: which failed, and the process exit code. */
export function summarize(results: RecapResult[]): { failed: RecapResult[]; exitCode: number } {
  const failed = results.filter((r) => r.status === 'failed');
  return { failed, exitCode: failed.length > 0 ? 1 : 0 };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const shared = loadSharedConfig();

  const leagues = parseLeaguesJson(readFileSync(join(REPO_ROOT, 'leagues.json'), 'utf8'));
  const secrets = parseLeagueSecretsJson(required('LEAGUE_SECRETS_JSON'));

  if (leagues.length === 0) {
    console.log('leagues.json has no leagues configured. Nothing to send.');
    return;
  }

  const settled = await Promise.allSettled(leagues.map((l) => runLeagueRecap(l, secrets, shared, args)));
  // runLeagueRecap never throws, so every settlement is 'fulfilled'; unwrap defensively anyway.
  const results: RecapResult[] = settled.map((s, i) =>
    s.status === 'fulfilled' ? s.value : { leagueId: leagues[i]!.id, status: 'failed', error: s.reason },
  );

  const { failed, exitCode } = summarize(results);

  if (!args.dryRun) {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : undefined;

    const alertBase = { apiKey: shared.resendApiKey, from: shared.emailFrom, ownerEmail: shared.ownerAlertEmail, runUrl };
    const alertJobs = [
      ...failed.map((r) => ({
        leagueId: r.leagueId,
        send: () => sendFailureAlert({ ...alertBase, leagueId: r.leagueId, error: r.error! }),
      })),
      ...results
        .filter((r) => r.leaderboardError)
        .map((r) => ({
          leagueId: r.leagueId,
          send: () => sendLeaderboardSkippedAlert({ ...alertBase, leagueId: r.leagueId, error: r.leaderboardError! }),
        })),
    ];

    const alerts = await Promise.allSettled(alertJobs.map((job) => job.send()));
    alerts.forEach((a, i) => {
      if (a.status === 'rejected') {
        console.error(`[${alertJobs[i]!.leagueId}] Alert did not send:`, a.reason);
      }
    });
  }

  console.log(`Done: ${results.length - failed.length}/${results.length} leagues succeeded.`);
  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Recap failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
