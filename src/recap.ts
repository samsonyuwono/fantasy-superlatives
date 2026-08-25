/**
 * Weekly entrypoint: determine the just-completed NFL week, fetch it from ESPN, compute the
 * superlatives, have Claude write the roast, then email it (or print it with --dry-run).
 *
 * Usage:
 *   tsx src/recap.ts               # normal weekly run (honours the Weeks 1–14 gate)
 *   tsx src/recap.ts --week 5      # force a specific week (bypasses the gate)
 *   tsx src/recap.ts --dry-run     # print the email to stdout instead of sending
 */
import 'dotenv/config';
import { computeAwards } from './awards.js';
import { fetchWeek, type EspnConfig } from './espn.js';
import { generateRoast } from './roast.js';
import { formatEmailBody, formatSubject } from './format.js';
import { sendRecap } from './emailer.js';
import { completedWeek, isInSeason } from './week.js';

interface Args {
  week?: number;
  dryRun: boolean;
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

function loadEspnConfig(): EspnConfig {
  return {
    leagueId: Number(required('LEAGUE_ID')),
    seasonYear: Number(required('SEASON_YEAR')),
    espnS2: required('ESPN_S2'),
    swid: required('ESPN_SWID'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Determine the week. An explicit --week overrides the calendar gate (for testing/backfill).
  const week = args.week ?? completedWeek(required('SEASON_WEEK1_TUESDAY'), new Date());

  if (args.week === undefined && !isInSeason(week)) {
    console.log(`Week ${week} is outside the regular season (Weeks 1–14). Nothing to send.`);
    return;
  }

  console.log(`Building the Week ${week} recap...`);
  const espnConfig = loadEspnConfig();
  const { matchups, standings } = await fetchWeek(espnConfig, week);
  if (matchups.length === 0) {
    throw new Error(`No matchups returned for Week ${week} — check the league ID, season, and cookies.`);
  }
  console.log(`Fetched ${matchups.length} matchups for Week ${week} of ${espnConfig.seasonYear}.`);

  const teams = matchups.flatMap((m) => [m.home, m.away]);
  if (teams.every((t) => t.score === 0)) {
    throw new Error(
      `Week ${week} of season ${espnConfig.seasonYear} has no scores yet (every team is 0.0). ` +
        `This usually means that season/week hasn't been played. To test now, set SEASON_YEAR ` +
        `in .env to a completed season (e.g. 2025).`,
    );
  }

  const awards = computeAwards(matchups, week);

  const roast = await generateRoast(awards, {
    apiKey: required('ANTHROPIC_API_KEY'),
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  });

  const subject = formatSubject(week);
  const body = formatEmailBody(awards, roast, standings);

  if (args.dryRun) {
    console.log('\n--- DRY RUN (not sending) ---');
    console.log(`Subject: ${subject}\n`);
    console.log(body);
    return;
  }

  await sendRecap({
    apiKey: required('RESEND_API_KEY'),
    from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: required('RECIPIENT_EMAIL'),
    subject,
    text: body,
  });
  console.log(`Sent the Week ${week} recap to ${required('RECIPIENT_EMAIL')}.`);
}

main().catch((err) => {
  console.error('Recap failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
