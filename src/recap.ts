import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeAwards } from './awards.js';
import { EspnAccessError, httpStatus, leagueFetcher } from './espn.js';
import { buildLeaderboard, type SeasonLeaderboard } from './leaderboard.js';
import { generateRoast, parsePipelineMode, type PipelineMode } from './roast.js';
import { formatEmailBody, formatSubject } from './format.js';
import { sendRecap, sendFailureAlert, sendLeaderboardSkippedAlert, type SecretFixes } from './emailer.js';
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

interface CommandLineOptions {
  week?: number;
  dryRun: boolean;
}

interface SharedConfig {
  anthropicApiKey: string;
  anthropicModel: string;
  roastPipeline: PipelineMode;
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

function parseCommandLineOptions(commandLineArguments: string[]): CommandLineOptions {
  const options: CommandLineOptions = { dryRun: false };
  for (let i = 0; i < commandLineArguments.length; i++) {
    const argument = commandLineArguments[i];
    if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--week') {
      const week = Number(commandLineArguments[++i]);
      if (!Number.isInteger(week)) throw new Error('--week requires an integer, e.g. --week 5');
      options.week = week;
    }
  }
  return options;
}

function loadSharedConfig(): SharedConfig {
  return {
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    roastPipeline: parsePipelineMode(process.env.ROAST_PIPELINE),
    resendApiKey: required('RESEND_API_KEY'),
    emailFrom: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    ownerAlertEmail: required('OWNER_ALERT_EMAIL'),
  };
}

async function runLeagueRecap(
  league: LeagueConfig,
  secrets: Record<string, LeagueSecrets>,
  sharedConfig: SharedConfig,
  options: CommandLineOptions,
): Promise<RecapResult> {
  try {
    const isWeekForced = options.week !== undefined;
    const week = options.week ?? completedWeek(league.seasonWeek1Tuesday, new Date());

    if (!isWeekForced && !isInSeason(week)) {
      console.info(`[${league.displayName}] Week ${week} is outside the regular season (Weeks 1–14). Nothing to send.`);
      return { leagueId: league.id, status: 'skipped' };
    }

    console.info(`[${league.displayName}] Building the Week ${week} recap...`);
    const espnFetcher = leagueFetcher(resolveEspnConfig(league, secrets));
    const { matchups } = await espnFetcher.week(week);
    if (matchups.length === 0) {
      throw new Error(`No matchups returned for Week ${week} — check the league ID, season, and cookies.`);
    }
    console.info(`[${league.displayName}] Fetched ${matchups.length} matchups for Week ${week} of ${league.seasonYear}.`);

    const teams = matchups.flatMap((matchup) => [matchup.home, matchup.away]);
    if (teams.every((team) => team.score === 0)) {
      throw new Error(
        `Week ${week} of season ${league.seasonYear} has no scores yet (every team is 0.0). ` +
          `This usually means that season/week hasn't been played. To test now, point this league ` +
          `at a completed season (e.g. 2025) in leagues.json.`,
      );
    }

    const awards = computeAwards(matchups, week);

    let leaderboard: SeasonLeaderboard | undefined;
    let leaderboardError: Error | undefined;
    if (week > 1 && isInSeason(week)) {
      try {
        const earlierWeekNumbers = Array.from({ length: week - 1 }, (_, i) => i + 1);
        const earlierWeeks = await espnFetcher.earlierWeeks(earlierWeekNumbers);
        leaderboard = buildLeaderboard([...earlierWeeks, { week, matchups }]);
      } catch (error) {
        leaderboardError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[${league.displayName}] Sending without the season leaderboard:`, leaderboardError.message);
      }
    }

    const roast = await generateRoast(
      awards,
      {
        apiKey: sharedConfig.anthropicApiKey,
        model: sharedConfig.anthropicModel,
        pipeline: sharedConfig.roastPipeline,
        league: league.displayName,
      },
      leaderboard,
    );

    const subject = formatSubject(week, league.displayName);
    const body = formatEmailBody(awards, roast, leaderboard);

    if (options.dryRun) {
      console.info(`\n--- DRY RUN: ${league.displayName} (not sending) ---`);
      console.info(`Subject: ${subject}\n`);
      console.info(body);
      return { leagueId: league.id, status: 'skipped' };
    }

    await sendRecap({
      apiKey: sharedConfig.resendApiKey,
      from: sharedConfig.emailFrom,
      to: league.recipientEmails,
      subject,
      text: body,
    });
    console.info(`[${league.displayName}] Sent the Week ${week} recap to ${league.recipientEmails.join(', ')}.`);
    return { leagueId: league.id, status: 'sent', leaderboardError };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.error(`[${league.displayName}] Recap failed:`, error.message);
    return { leagueId: league.id, status: 'failed', error };
  }
}

/** The cookie fixes for a failed league when ESPN rejected its cookies (401/403), else undefined. */
export function cookieFixesFor(leagueId: string, error: Error, secrets: Record<string, LeagueSecrets>): SecretFixes | undefined {
  if (!EspnAccessError.isAuthStatus(httpStatus(error))) return undefined;
  const accounts = accountsToUpdate([leagueId], secrets);
  return accounts.length > 0 ? { accounts, missing: [] } : undefined;
}

/** Pure summary of a batch of league results: which failed, and the process exit code. */
export function summarize(results: RecapResult[]): { failed: RecapResult[]; exitCode: number } {
  const failed = results.filter((result) => result.status === 'failed');
  return { failed, exitCode: failed.length > 0 ? 1 : 0 };
}

async function main(): Promise<void> {
  const options = parseCommandLineOptions(process.argv.slice(2));
  const sharedConfig = loadSharedConfig();

  const leagues = parseLeaguesJson(readFileSync(join(REPOSITORY_ROOT, 'leagues.json'), 'utf8'));
  const secrets = parseLeagueSecretsJson(required('LEAGUE_SECRETS_JSON'));

  if (leagues.length === 0) {
    console.info('leagues.json has no leagues configured. Nothing to send.');
    return;
  }

  const settledRecaps = await Promise.allSettled(
    leagues.map((league) => runLeagueRecap(league, secrets, sharedConfig, options)),
  );
  const results: RecapResult[] = settledRecaps.map((settlement, i) =>
    settlement.status === 'fulfilled'
      ? settlement.value
      : { leagueId: leagues[i]!.id, status: 'failed', error: settlement.reason },
  );

  const { failed, exitCode } = summarize(results);
  const leagueById = new Map(leagues.map((league) => [league.id, league]));

  if (!options.dryRun) {
    const runUrl = githubRunUrl();

    const sharedAlertOptions = {
      apiKey: sharedConfig.resendApiKey,
      from: sharedConfig.emailFrom,
      ownerEmail: sharedConfig.ownerAlertEmail,
      runUrl,
    };
    const alertJobs = [
      ...failed.map((result) => {
        const league = leagueById.get(result.leagueId)!;
        const fixes = cookieFixesFor(result.leagueId, result.error!, secrets);
        return {
          league,
          failure: true,
          send: () => sendFailureAlert({ ...sharedAlertOptions, league, error: result.error!, fixes }),
        };
      }),
      ...results
        .filter((result) => result.leaderboardError)
        .map((result) => {
          const league = leagueById.get(result.leagueId)!;
          return {
            league,
            failure: false,
            send: () => sendLeaderboardSkippedAlert({ ...sharedAlertOptions, league, error: result.leaderboardError! }),
          };
        }),
    ];

    const settledAlerts = await Promise.allSettled(alertJobs.map((job) => job.send()));
    settledAlerts.forEach((settlement, i) => {
      if (settlement.status === 'rejected') {
        console.error(`[${alertJobs[i]!.league.displayName}] Alert did not send:`, settlement.reason);
      }
    });

    const everyFailedLeagueAlerted = settledAlerts.every(
      (settlement, i) => !alertJobs[i]!.failure || settlement.status === 'fulfilled',
    );
    if (failed.length > 0 && everyFailedLeagueAlerted) {
      setGithubOutput('alerted', 'true');
    }
  }

  console.info(`Done: ${results.length - failed.length}/${results.length} leagues succeeded.`);
  process.exitCode = exitCode;
}

const isRunDirectly = import.meta.url === `file://${process.argv[1]}`;
if (isRunDirectly) {
  main().catch((error) => {
    console.error('Recap failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
