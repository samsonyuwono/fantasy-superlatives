import { execFileSync } from 'node:child_process';
import { setGithubOutput } from './env.js';

/** Must match the `run-name` title in .github/workflows/weekly-recap.yml. */
export const NINE_AM_RUN_TITLE = 'Weekly recap (9am trigger)';

export interface WorkflowRun {
  displayTitle: string;
  createdAt: string;
}

/** The calendar date ('YYYY-MM-DD') of `date` in New York, where the recap schedule lives. */
export function newYorkDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * True when this is a scheduled (fallback) run and today's 9am-triggered run already exists. The on-time
 * 9am ET send is a `workflow_dispatch` from an external scheduler, titled NINE_AM_RUN_TITLE; GitHub's own
 * `schedule` trigger is only a fallback in case that dispatch never fired. The 9am run counts whatever
 * its result, since recap.ts may have sent some leagues before another failed (and that failure was
 * already alerted).
 */
export function shouldSkipFallback(eventName: string, recentRuns: WorkflowRun[], now: Date): boolean {
  if (eventName !== 'schedule') return false;
  const today = newYorkDate(now);
  return recentRuns.some(
    (run) => run.displayTitle === NINE_AM_RUN_TITLE && newYorkDate(new Date(run.createdAt)) === today,
  );
}

function main(): void {
  const eventName = process.env.GITHUB_EVENT_NAME ?? '';
  const recentRuns: WorkflowRun[] =
    eventName === 'schedule'
      ? JSON.parse(
          execFileSync(
            'gh',
            ['run', 'list', '--workflow', 'weekly-recap.yml', '--limit', '20', '--json', 'displayTitle,createdAt'],
            { encoding: 'utf8' },
          ),
        )
      : [];

  const shouldSkip = shouldSkipFallback(eventName, recentRuns, new Date());
  console.info(
    shouldSkip
      ? `The 9am-triggered run already happened today (${newYorkDate(new Date())}). Skipping the fallback.`
      : `Proceeding with the recap (event: ${eventName || 'unknown'}).`,
  );

  setGithubOutput('skip', String(shouldSkip));
}

const isRunDirectly = import.meta.url === `file://${process.argv[1]}`;
if (isRunDirectly) {
  main();
}
