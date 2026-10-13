/**
 * Turns the computed awards into a short, punchy group-chat roast via the Claude API.
 * The key facts are computed deterministically in `awards.ts`; Claude only writes the prose.
 *
 * With `ROAST_PIPELINE=on`, an orchestrated pipeline writes it: an analyst picks storylines, a writer
 * drafts, and each draft must pass a code check (`factcheck.ts`) and a Claude checker, or it goes
 * back to the writer with the issues. If every draft fails, the single-call roast is sent instead.
 * `shadow` (the default) sends the single-call roast and only logs what the pipeline would have sent.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AllPlayRecord, MatchupOutcome, MatchupResult, WeekAwards } from './awards.js';
import { callClaude, claudeAgents, ROAST_PROMPT, type Agents, type Revision } from './agents.js';
import { verifyDraft } from './factcheck.js';
import {
  describeWeeks,
  MIN_WINS_TO_LEAD,
  SEASON_AWARD_KEYS,
  SEASON_AWARD_NAMES,
  type SeasonLeaderboard,
} from './leaderboard.js';

export interface RoastOptions {
  apiKey: string;
  model: string;
  pipeline?: PipelineMode;
  /** The league's display name, to tell leagues apart in the logs since they run at the same time. */
  league?: string;
}

/** e.g. "2 of the other 9 teams", or "2 of the other 9 teams and tied 1". */
function allPlayText(r: AllPlayRecord): string {
  const base = `${r.beaten} of the other ${r.opponents} teams`;
  return r.tied > 0 ? `${base} and tied ${r.tied}` : base;
}

const n = (x: number) => x.toFixed(1);

/** The two ways an award's mistake is described, e.g. for the Sleepwalker. */
interface Mistake {
  /** "the points left on the bench" */
  what: string;
  /** "their best lineup" */
  fix: string;
}

const SLEEPWALKER_MISTAKE: Mistake = { what: 'the points left on the bench', fix: 'their best lineup' };
const BONEHEAD_MISTAKE: Mistake = { what: 'that start/sit', fix: 'the right start/sit' };

/** e.g. "Delta still won 80.0–75.0 over Echo, so the points left on the bench didn't cost them the game." */
function outcomeText(team: string, m: MatchupOutcome | undefined, { what, fix }: Mistake): string {
  if (!m) return '';
  const vs = `${n(m.score)}–${n(m.opponentScore)}`;
  if (m.result === 'won') return ` ${team} still won ${vs} over ${m.opponent}, so ${what} didn't cost them the game.`;
  if (m.result === 'tied') {
    return m.flipped
      ? ` ${team} tied ${m.opponent} at ${n(m.score)}, and with ${fix} they would have won.`
      : ` ${team} tied ${m.opponent} at ${n(m.score)}, so ${what} didn't cost them the win.`;
  }
  return m.flipped
    ? ` ${team} lost ${vs} to ${m.opponent}, and with ${fix} they would have won.`
    : ` ${team} lost ${vs} to ${m.opponent}, and would have lost even with ${fix}.`;
}

function resultLine(r: MatchupResult): string {
  if (r.homeScore === r.awayScore) return `- ${r.home} and ${r.away} tied at ${n(r.homeScore)}`;
  const [w, ws, l, ls] = r.homeScore > r.awayScore ? [r.home, r.homeScore, r.away, r.awayScore] : [r.away, r.awayScore, r.home, r.homeScore];
  return `- ${w} beat ${l}, ${n(ws)}–${n(ls)} (by ${n(ws - ls)})`;
}

/** A compact, unambiguous fact sheet for the model — no room to hallucinate the numbers. */
export function factSheet(a: WeekAwards, leaderboard?: SeasonLeaderboard): string {
  const lines = [
    `Week ${a.week} fantasy football results. The award names are fixed — use them verbatim.`,
    '',
    `- The Juggernaut (highest team score): ${a.juggernaut.team} — ${n(a.juggernaut.score)} pts`,
    `- The Corpse (lowest team score): ${a.corpse.team} — ${n(a.corpse.score)} pts`,
    `- Baller of the Week (top individual starter): ${a.ballerOfTheWeek.player} on ${a.ballerOfTheWeek.team} — ${n(a.ballerOfTheWeek.points)} pts`,
    `- The Sleepwalker (most points left on the bench): ${a.sleepwalker.team} — left ${n(a.sleepwalker.pointsLeft)} pts on the bench (started ${n(a.sleepwalker.actual)}, optimal was ${n(a.sleepwalker.optimal)}).${outcomeText(a.sleepwalker.team, a.sleepwalker.matchup, SLEEPWALKER_MISTAKE)}`,
    `- The Bonehead (worst start/sit): ${a.bonehead.team} benched ${a.bonehead.benched} (${n(a.bonehead.benchedPoints)}) and started ${a.bonehead.started} (${n(a.bonehead.startedPoints)}) at ${a.bonehead.slot} — a ${n(a.bonehead.regret)}-pt blunder.${outcomeText(a.bonehead.team, a.bonehead.matchup, BONEHEAD_MISTAKE)}`,
    a.backedIntoIt.teamId === undefined
      ? '- Backed Into It (luckiest win): nobody, since every matchup this week was a tie'
      : `- Backed Into It (luckiest win): ${a.backedIntoIt.team} won with ${n(a.backedIntoIt.score)} pts (would have beaten ${allPlayText(a.backedIntoIt.allPlay)})`,
    a.robbed.teamId === undefined
      ? '- Robbed (unluckiest loss): nobody, since every matchup this week was a tie'
      : `- Robbed (unluckiest loss): ${a.robbed.team} lost with ${n(a.robbed.score)} pts (would have beaten ${allPlayText(a.robbed.allPlay)})`,
  ];
  if (a.results.length > 0) lines.push('', 'Matchup results:', ...a.results.map(resultLine));
  if (leaderboard) lines.push('', ...seasonFacts(a, leaderboard));
  return lines.join('\n');
}

/** Season-to-date facts: repeat winners from this week, then each award's season leader. */
function seasonFacts(a: WeekAwards, lb: SeasonLeaderboard): string[] {
  const lines = [`Season so far (${describeWeeks(lb.weeks)}):`];
  for (const key of SEASON_AWARD_KEYS) {
    const teamId = a[key].teamId;
    if (teamId === undefined) continue;
    const wins = lb.counts[key].get(teamId) ?? 0;
    // Only repeat winners, and only once the award would show on the leaderboard.
    if (wins >= Math.max(2, MIN_WINS_TO_LEAD[key])) lines.push(`- ${a[key].team} has now won ${SEASON_AWARD_NAMES[key]} ${wins} times this season (including this week).`);
  }
  for (const key of SEASON_AWARD_KEYS) {
    const leader = lb.leaders[key];
    if (leader) lines.push(`- Season leader for ${SEASON_AWARD_NAMES[key]}: ${leader.teams.join(' and ')} with ${leader.count}`);
  }
  return lines;
}

export type PipelineMode = 'off' | 'shadow' | 'on';

const PIPELINE_MODES: readonly PipelineMode[] = ['off', 'shadow', 'on'];

/** Reads `ROAST_PIPELINE`. Unset means shadow; an unknown value warns and falls back to shadow. */
export function parsePipelineMode(value: string | undefined, warn: (msg: string) => void = console.warn): PipelineMode {
  if (!value) return 'shadow';
  if ((PIPELINE_MODES as readonly string[]).includes(value)) return value as PipelineMode;
  warn(`Unknown ROAST_PIPELINE "${value}", so using "shadow". Expected one of: ${PIPELINE_MODES.join(', ')}.`);
  return 'shadow';
}

/** Writer attempts before the pipeline gives up: the first draft plus two revisions. */
export const MAX_ATTEMPTS = 3;

export interface PipelineResult {
  /** The approved roast, or null when every draft was rejected or an agent failed. */
  roast: string | null;
  /** One line describing what each agent did, for the logs. */
  trace: string;
}

/**
 * Runs analyst → writer → code check → Claude checker, sending rejected drafts back to the writer
 * with the issues. Never throws: a failing writer or checker call uses up that attempt, and the run
 * ends with `roast: null` once every attempt is used.
 */
export async function runPipeline(sheet: string, agents: Agents): Promise<PipelineResult> {
  const steps: string[] = [];
  let calls = 0;
  const done = (roast: string | null) => ({ roast, trace: `roast: ${steps.join(', ')}, ${calls} calls` });

  let storylines: string[] = [];
  try {
    calls++;
    storylines = await agents.analyst(sheet);
    steps.push(`analyst ok (${storylines.length} storylines)`);
  } catch (err) {
    steps.push(`analyst failed (${errorMessage(err)}), writing without storylines`);
  }

  let revision: Revision | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      calls++;
      const draft = await agents.writer(sheet, storylines, revision);

      const codeIssues = verifyDraft(draft, sheet);
      if (codeIssues.length > 0) {
        steps.push(`draft ${attempt} rejected (code: ${quote(codeIssues)})`);
        revision = { draft, issues: codeIssues };
        continue;
      }

      calls++;
      const verdict = await agents.checker(sheet, draft);
      if (verdict.approved) {
        steps.push(`draft ${attempt} approved`);
        return done(draft);
      }
      steps.push(`draft ${attempt} rejected (checker: ${quote(verdict.issues)})`);
      revision = { draft, issues: verdict.issues.length > 0 ? verdict.issues : ['The checker rejected the draft.'] };
    } catch (err) {
      steps.push(`draft ${attempt} failed (${errorMessage(err)})`);
    }
  }
  steps.push('gave up');
  return done(null);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function quote(issues: string[]): string {
  const [first, ...rest] = issues;
  return rest.length > 0 ? `"${first}" +${rest.length} more` : `"${first}"`;
}

export interface RoastDeps {
  agents: Agents;
  /** Today's single-call roast. It's the fallback, and what shadow mode sends. */
  legacy(sheet: string): Promise<string>;
  log(message: string): void;
}

// Per request, before the SDK's retries. The SDK default is 10 minutes, and a roast call takes seconds,
// so a hung call fails fast into the next attempt or the fallback.
const CLAUDE_TIMEOUT_MS = 90_000;

function claudeDeps(opts: RoastOptions): RoastDeps {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: CLAUDE_TIMEOUT_MS });
  return {
    agents: claudeAgents(client, opts.model),
    legacy: (sheet) => callClaude(client, opts.model, { system: ROAST_PROMPT, user: sheet }),
    log: (message) => console.info(message),
  };
}

/**
 * Generate the roast text, according to `opts.pipeline`. Throws only if the roast that would be
 * sent fails (the caller decides how to handle it); a failing pipeline never blocks the send.
 */
export async function generateRoast(
  awards: WeekAwards,
  opts: RoastOptions,
  leaderboard?: SeasonLeaderboard,
  deps: RoastDeps = claudeDeps(opts),
): Promise<string> {
  const sheet = factSheet(awards, leaderboard);
  const mode = opts.pipeline ?? 'shadow';
  const log = (message: string) => deps.log(opts.league ? `[${opts.league}] ${message}` : message);

  if (mode === 'off') return deps.legacy(sheet);

  if (mode === 'shadow') {
    // Not awaited, so a slow pipeline never delays the send. It logs whenever it finishes, and the
    // process stays alive until then.
    void runPipeline(sheet, deps.agents).then(
      ({ roast, trace }) => {
        log(`[shadow] ${trace}`);
        if (roast) log(`[shadow] Pipeline roast (not sent):\n${roast}`);
      },
      (err: unknown) => log(`[shadow] pipeline crashed: ${errorMessage(err)}`),
    );
    return deps.legacy(sheet);
  }

  const { roast, trace } = await runPipeline(sheet, deps.agents);
  log(trace);
  if (roast) return roast;
  log('roast: falling back to the single-call roast');
  return deps.legacy(sheet);
}
