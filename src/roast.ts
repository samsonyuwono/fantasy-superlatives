import Anthropic from '@anthropic-ai/sdk';
import {
  AWARDS,
  NOBODY_BLUNDERED_REASON,
  slotLabel,
  wholePercent,
  type AllPlayRecord,
  type AwardKey,
  type MatchupOutcome,
  type MatchupResult,
  type WeekAwards,
} from './awards.js';
import { callClaude, claudeAgents, ROAST_PROMPT, type Agents, type Revision } from './agents.js';
import { verifyDraft } from './factcheck.js';
import { describeWeeks, MIN_WINS_TO_LEAD, SEASON_AWARD_KEYS, type SeasonLeaderboard } from './leaderboard.js';

export interface RoastOptions {
  apiKey: string;
  model: string;
  pipeline?: PipelineMode;
  league?: string;
}

function allPlayText(record: AllPlayRecord): string {
  const base = `${record.beaten} of the other ${record.otherTeams} teams`;
  return record.tied > 0 ? `${base} and tied ${record.tied}` : base;
}

const formatPoints = (points: number) => points.toFixed(1);

interface Mistake {
  what: string;
  fix: string;
}

const SLEEPWALKER_MISTAKE: Mistake = { what: 'the points left on the bench', fix: 'their best lineup' };
const BONEHEAD_MISTAKE: Mistake = { what: 'that start/sit', fix: 'the right start/sit' };

function outcomeText(team: string, outcome: MatchupOutcome | undefined, { what, fix }: Mistake): string {
  if (!outcome) return '';
  const finalScore = `${formatPoints(outcome.score)}–${formatPoints(outcome.opponentScore)}`;
  if (outcome.result === 'won') return ` ${team} still won ${finalScore} over ${outcome.opponent}, so ${what} didn't cost them the game.`;
  if (outcome.result === 'tied') {
    return outcome.mistakeCostTheWin
      ? ` ${team} tied ${outcome.opponent} at ${formatPoints(outcome.score)}, and with ${fix} they would have won.`
      : ` ${team} tied ${outcome.opponent} at ${formatPoints(outcome.score)}, so ${what} didn't cost them the win.`;
  }
  return outcome.mistakeCostTheWin
    ? ` ${team} lost ${finalScore} to ${outcome.opponent}, and with ${fix} they would have won.`
    : ` ${team} lost ${finalScore} to ${outcome.opponent}, and would have lost even with ${fix}.`;
}

function resultLine(result: MatchupResult): string {
  if (result.homeScore === result.awayScore) return `- ${result.home} and ${result.away} tied at ${formatPoints(result.homeScore)}`;
  const [winner, winnerScore, loser, loserScore] = result.homeScore > result.awayScore ? [result.home, result.homeScore, result.away, result.awayScore] : [result.away, result.awayScore, result.home, result.homeScore];
  return `- ${winner} beat ${loser}, ${formatPoints(winnerScore)}–${formatPoints(loserScore)} (by ${formatPoints(winnerScore - loserScore)})`;
}

const awardFact = (key: AwardKey, detail: string) => `- ${AWARDS[key].name} (${AWARDS[key].description}): ${detail}`;

/** A compact, unambiguous fact sheet for the model — no room to hallucinate the numbers. */
export function factSheet(awards: WeekAwards, leaderboard?: SeasonLeaderboard): string {
  const lines = [
    `Week ${awards.week} fantasy football results. The award names are fixed — use them verbatim.`,
    '',
    awardFact('juggernaut', `${awards.juggernaut.team} — ${formatPoints(awards.juggernaut.score)} pts`),
    awardFact('corpse', `${awards.corpse.team} — ${formatPoints(awards.corpse.score)} pts`),
    awardFact('ballerOfTheWeek', `${awards.ballerOfTheWeek.player} on ${awards.ballerOfTheWeek.team} — ${formatPoints(awards.ballerOfTheWeek.points)} pts`),
    awardFact('sleepwalker', `${awards.sleepwalker.team} — left ${formatPoints(awards.sleepwalker.pointsLeft)} pts on the bench (started ${formatPoints(awards.sleepwalker.actual)}, optimal was ${formatPoints(awards.sleepwalker.optimal)}).${outcomeText(awards.sleepwalker.team, awards.sleepwalker.matchup, SLEEPWALKER_MISTAKE)}`),
    awardFact(
      'bonehead',
      awards.bonehead.teamId === undefined
        ? `nobody, since ${NOBODY_BLUNDERED_REASON}`
        : `${awards.bonehead.team} benched ${awards.bonehead.benched} (${formatPoints(awards.bonehead.benchedPoints)}) and started ${awards.bonehead.started} (${formatPoints(awards.bonehead.startedPoints)}) at ${slotLabel(awards.bonehead.slot)} — a ${formatPoints(awards.bonehead.regret)}-pt blunder.${outcomeText(awards.bonehead.team, awards.bonehead.matchup, BONEHEAD_MISTAKE)}`,
    ),
    awardFact(
      'backedIntoIt',
      awards.backedIntoIt.teamId === undefined
        ? 'nobody, since every matchup this week was a tie'
        : `${awards.backedIntoIt.team} won with ${formatPoints(awards.backedIntoIt.score)} pts (would have beaten ${allPlayText(awards.backedIntoIt.allPlay)})`,
    ),
    awardFact(
      'robbed',
      awards.robbed.teamId === undefined
        ? 'nobody, since every matchup this week was a tie'
        : `${awards.robbed.team} lost with ${formatPoints(awards.robbed.score)} pts (would have beaten ${allPlayText(awards.robbed.allPlay)})`,
    ),
  ];
  const bonusFacts = bonusAwardFacts(awards);
  if (bonusFacts.length > 0) lines.push('', 'Bonus awards this week (optional to mention):', ...bonusFacts);
  if (awards.results.length > 0) lines.push('', 'Matchup results:', ...awards.results.map(resultLine));
  if (leaderboard) lines.push('', ...seasonFacts(awards, leaderboard));
  return lines.join('\n');
}

function bonusAwardFacts({ heartbreaker, mercyRule, oneManArmy }: WeekAwards): string[] {
  const facts: string[] = [];
  if (heartbreaker) {
    facts.push(awardFact('heartbreaker', `${heartbreaker.team} lost ${formatPoints(heartbreaker.score)}–${formatPoints(heartbreaker.opponentScore)} to ${heartbreaker.opponent}, by ${formatPoints(heartbreaker.margin)}`));
  }
  if (mercyRule) {
    facts.push(awardFact('mercyRule', `${mercyRule.team} beat ${mercyRule.opponent} ${formatPoints(mercyRule.score)}–${formatPoints(mercyRule.opponentScore)}, by ${formatPoints(mercyRule.margin)}`));
  }
  if (oneManArmy) {
    facts.push(awardFact('oneManArmy', `${oneManArmy.player} scored ${formatPoints(oneManArmy.points)} of ${oneManArmy.team}'s ${formatPoints(oneManArmy.teamScore)} pts (${wholePercent(oneManArmy.share)})`));
  }
  return facts;
}

function seasonFacts(awards: WeekAwards, leaderboard: SeasonLeaderboard): string[] {
  const lines = [`Season so far (${describeWeeks(leaderboard.weeks)}):`];
  for (const key of SEASON_AWARD_KEYS) {
    const award = awards[key];
    const teamId = award?.teamId;
    if (!award || teamId === undefined) continue;
    const wins = leaderboard.winsByTeamId[key].get(teamId) ?? 0;
    const isRepeatWinner = wins >= 2;
    const isShownOnLeaderboard = wins >= MIN_WINS_TO_LEAD[key];
    if (isRepeatWinner && isShownOnLeaderboard) lines.push(`- ${award.team} has now won ${AWARDS[key].name} ${wins} times this season (including this week).`);
  }
  for (const key of SEASON_AWARD_KEYS) {
    const leader = leaderboard.leaders[key];
    if (leader) lines.push(`- Season leader for ${AWARDS[key].name}: ${leader.teams.join(' and ')} with ${leader.count}`);
  }
  return lines;
}

export type PipelineMode = 'off' | 'shadow' | 'on';

const PIPELINE_MODES: readonly PipelineMode[] = ['off', 'shadow', 'on'];

/** Reads `ROAST_PIPELINE`. Unset means shadow; an unknown value warns and falls back to shadow. */
export function parsePipelineMode(value: string | undefined, warn: (message: string) => void = console.warn): PipelineMode {
  if (!value) return 'shadow';
  if ((PIPELINE_MODES as readonly string[]).includes(value)) return value as PipelineMode;
  warn(`Unknown ROAST_PIPELINE "${value}", so using "shadow". Expected one of: ${PIPELINE_MODES.join(', ')}.`);
  return 'shadow';
}

/** Writer attempts before the pipeline gives up: the first draft plus two revisions. */
export const MAX_ATTEMPTS = 3;

export interface PipelineResult {
  roast: string | null;
  trace: string;
}

/**
 * Runs analyst → writer → code check → Claude checker, sending rejected drafts back to the writer
 * with the issues. Never throws: a failing writer or checker call uses up that attempt, and the run
 * ends with `roast: null` once every attempt is used. `trace` is one log line describing what each
 * agent did.
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
  } catch (error) {
    steps.push(`analyst failed (${errorMessage(error)}), writing without storylines`);
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
    } catch (error) {
      steps.push(`draft ${attempt} failed (${errorMessage(error)})`);
    }
  }
  steps.push('gave up');
  return done(null);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quote(issues: string[]): string {
  const [first, ...rest] = issues;
  return rest.length > 0 ? `"${first}" +${rest.length} more` : `"${first}"`;
}

export interface RoastDependencies {
  agents: Agents;
  legacy(sheet: string): Promise<string>;
  log(message: string): void;
}

const CLAUDE_REQUEST_TIMEOUT_MILLISECONDS = 90_000;

function claudeDependencies(options: RoastOptions): RoastDependencies {
  const client = new Anthropic({ apiKey: options.apiKey, timeout: CLAUDE_REQUEST_TIMEOUT_MILLISECONDS });
  return {
    agents: claudeAgents(client, options.model),
    legacy: (sheet) => callClaude(client, options.model, { system: ROAST_PROMPT, user: sheet }),
    log: (message) => console.info(message),
  };
}

/**
 * Generate the roast text from a fixed fact sheet, according to `options.pipeline`. The key facts are
 * computed deterministically in `awards.ts`; Claude only writes the prose.
 *
 * - `off`: the single-call roast (`legacy`) only. The instant rollback.
 * - `shadow` (the default): sends the single-call roast and runs the pipeline in the background, only
 *   logging what it would have sent. It isn't awaited, so it never delays the send; it logs whenever it
 *   finishes, and the process stays alive until then.
 * - `on`: an orchestrated pipeline writes it: an analyst picks storylines, a writer drafts, and each
 *   draft must pass a code check (`factcheck.ts`) and a Claude checker, or it goes back to the writer
 *   with the issues. If every draft fails, the single-call roast is sent instead.
 *
 * Each Claude request times out after 90 seconds (before the SDK's retries; its default is 10 minutes),
 * so a hung call fails fast into the next attempt or the fallback. Throws only if the roast that would
 * be sent fails (the caller decides how to handle it); a failing pipeline never blocks the send.
 */
export async function generateRoast(
  awards: WeekAwards,
  options: RoastOptions,
  leaderboard?: SeasonLeaderboard,
  dependencies: RoastDependencies = claudeDependencies(options),
): Promise<string> {
  const sheet = factSheet(awards, leaderboard);
  const mode = options.pipeline ?? 'shadow';
  const log = (message: string) => dependencies.log(options.league ? `[${options.league}] ${message}` : message);

  if (mode === 'off') return dependencies.legacy(sheet);

  if (mode === 'shadow') {
    void runPipeline(sheet, dependencies.agents).then(
      ({ roast, trace }) => {
        log(`[shadow] ${trace}`);
        if (roast) log(`[shadow] Pipeline roast (not sent):\n${roast}`);
      },
      (error: unknown) => log(`[shadow] pipeline crashed: ${errorMessage(error)}`),
    );
    return dependencies.legacy(sheet);
  }

  const { roast, trace } = await runPipeline(sheet, dependencies.agents);
  log(trace);
  if (roast) return roast;
  log('roast: falling back to the single-call roast');
  return dependencies.legacy(sheet);
}
