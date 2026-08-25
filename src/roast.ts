/**
 * Turns the computed awards into a short, punchy group-chat roast via the Claude API.
 * The key facts are computed deterministically in `awards.ts`; Claude only writes the prose,
 * so it can't invent scores or winners.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { WeekAwards } from './awards.js';

export interface RoastOptions {
  apiKey: string;
  model: string;
}

/** A compact, unambiguous fact sheet for the model — no room to hallucinate the numbers. */
function factSheet(a: WeekAwards): string {
  const n = (x: number) => x.toFixed(1);
  return [
    `Week ${a.week} fantasy football results. The award names are fixed — use them verbatim.`,
    '',
    `- The Juggernaut (highest team score): ${a.juggernaut.team} — ${n(a.juggernaut.score)} pts`,
    `- The Corpse (lowest team score): ${a.corpse.team} — ${n(a.corpse.score)} pts`,
    `- Baller of the Week (top individual starter): ${a.ballerOfTheWeek.player} on ${a.ballerOfTheWeek.team} — ${n(a.ballerOfTheWeek.points)} pts`,
    `- The Sleepwalker (most points left on the bench): ${a.sleepwalker.team} — left ${n(a.sleepwalker.pointsLeft)} pts on the bench (started ${n(a.sleepwalker.actual)}, optimal was ${n(a.sleepwalker.optimal)})`,
    `- The Bonehead (worst start/sit): ${a.bonehead.team} benched ${a.bonehead.benched} (${n(a.bonehead.benchedPoints)}) and started ${a.bonehead.started} (${n(a.bonehead.startedPoints)}) at ${a.bonehead.slot} — a ${n(a.bonehead.regret)}-pt blunder`,
    `- Backed Into It (luckiest win): ${a.backedIntoIt.team} won with just ${n(a.backedIntoIt.score)} pts (would have beaten only ${Math.round(a.backedIntoIt.allPlayWinPct * 100)}% of the league)`,
    `- Robbed (unluckiest loss): ${a.robbed.team} lost despite ${n(a.robbed.score)} pts (would have beaten ${Math.round(a.robbed.allPlayWinPct * 100)}% of the league)`,
  ].join('\n');
}

const SYSTEM_PROMPT = `You are the commissioner of a fantasy football league writing the weekly awards recap for the group chat.
Voice: funny, savage but good-natured, high group-chat energy. Roast the losers, hype the winners.
Constraints:
- 150–250 words total.
- Mention every award, using its exact name (e.g. "The Juggernaut", "The Bonehead").
- Use the exact team names, player names, and point totals from the fact sheet. Never invent numbers or winners.
- Plain text suitable for pasting into WhatsApp. A few emojis are fine. No markdown headings, no bullet characters like "*".`;

/** Generate the roast text. Throws if the API call fails (the caller decides how to handle it). */
export async function generateRoast(awards: WeekAwards, opts: RoastOptions): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const message = await client.messages.create({
    model: opts.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: factSheet(awards) }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude returned an empty roast.');
  return text;
}
