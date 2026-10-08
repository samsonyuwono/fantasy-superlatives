/**
 * Turns the computed awards into a short, punchy group-chat roast via the Claude API.
 * The key facts are computed deterministically in `awards.ts`; Claude only writes the prose,
 * so it can't invent scores or winners.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AllPlayRecord, WeekAwards } from './awards.js';
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
}

/** e.g. "2 of the other 9 teams", or "2 of the other 9 teams and tied 1". */
function allPlayText(r: AllPlayRecord): string {
  const base = `${r.beaten} of the other ${r.opponents} teams`;
  return r.tied > 0 ? `${base} and tied ${r.tied}` : base;
}

/** A compact, unambiguous fact sheet for the model — no room to hallucinate the numbers. */
export function factSheet(a: WeekAwards, leaderboard?: SeasonLeaderboard): string {
  const n = (x: number) => x.toFixed(1);
  const lines = [
    `Week ${a.week} fantasy football results. The award names are fixed — use them verbatim.`,
    '',
    `- The Juggernaut (highest team score): ${a.juggernaut.team} — ${n(a.juggernaut.score)} pts`,
    `- The Corpse (lowest team score): ${a.corpse.team} — ${n(a.corpse.score)} pts`,
    `- Baller of the Week (top individual starter): ${a.ballerOfTheWeek.player} on ${a.ballerOfTheWeek.team} — ${n(a.ballerOfTheWeek.points)} pts`,
    `- The Sleepwalker (most points left on the bench): ${a.sleepwalker.team} — left ${n(a.sleepwalker.pointsLeft)} pts on the bench (started ${n(a.sleepwalker.actual)}, optimal was ${n(a.sleepwalker.optimal)})`,
    `- The Bonehead (worst start/sit): ${a.bonehead.team} benched ${a.bonehead.benched} (${n(a.bonehead.benchedPoints)}) and started ${a.bonehead.started} (${n(a.bonehead.startedPoints)}) at ${a.bonehead.slot} — a ${n(a.bonehead.regret)}-pt blunder`,
    a.backedIntoIt.teamId === undefined
      ? '- Backed Into It (luckiest win): nobody, since every matchup this week was a tie'
      : `- Backed Into It (luckiest win): ${a.backedIntoIt.team} won with ${n(a.backedIntoIt.score)} pts (would have beaten ${allPlayText(a.backedIntoIt.allPlay)})`,
    a.robbed.teamId === undefined
      ? '- Robbed (unluckiest loss): nobody, since every matchup this week was a tie'
      : `- Robbed (unluckiest loss): ${a.robbed.team} lost with ${n(a.robbed.score)} pts (would have beaten ${allPlayText(a.robbed.allPlay)})`,
  ];
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

const SYSTEM_PROMPT = `You are the commissioner of a fantasy football league writing the weekly awards recap for the group chat.
Voice: funny, savage but good-natured, high group-chat energy. Roast the losers, hype the winners.
Constraints:
- 150–250 words total.
- Mention every award, using its exact name (e.g. "The Juggernaut", "The Bonehead").
- Use the exact team names, player names, and point totals from the fact sheet. Never invent numbers or winners.
- If the fact sheet has a "Season so far" section, you may add a callback or two about it (e.g. a team's third Corpse). Keep the focus on this week, and only use season counts that appear in the sheet.
- Plain text suitable for pasting into WhatsApp. A few emojis are fine. No markdown headings, no bullet characters like "*".`;

/** Generate the roast text. Throws if the API call fails (the caller decides how to handle it). */
export async function generateRoast(
  awards: WeekAwards,
  opts: RoastOptions,
  leaderboard?: SeasonLeaderboard,
): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const message = await client.messages.create({
    model: opts.model,
    // Thinking tokens count against max_tokens, so leave headroom beyond the ~250-word roast.
    max_tokens: 4096,
    // A short roast doesn't need deep reasoning; low effort is faster and cheaper.
    output_config: { effort: 'low' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: factSheet(awards, leaderboard) }],
  });

  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
    throw new Error(`Claude did not finish the roast (stop_reason: ${message.stop_reason}).`);
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude returned an empty roast.');
  return text;
}
