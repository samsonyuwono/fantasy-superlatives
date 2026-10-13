/**
 * The specialist Claude agents behind the roast pipeline. Each agent is one Claude call with its
 * own system prompt; `roast.ts` decides the order they run in and what happens when one rejects.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { MAX_FREE_NUMBER } from './factcheck.js';

export interface Revision {
  draft: string;
  issues: string[];
}

export interface Verdict {
  approved: boolean;
  issues: string[];
}

export interface Agents {
  /** Picks the best angles for this week's roast. */
  analyst(sheet: string): Promise<string[]>;
  /** Writes the roast, or rewrites a rejected draft when given its issues. */
  writer(sheet: string, storylines: string[], revision?: Revision): Promise<string>;
  /** Checks a draft against the fact sheet for mistakes a code check can't see. */
  checker(sheet: string, draft: string): Promise<Verdict>;
}

export const ROAST_PROMPT = `You are the master roaster for a fantasy football league writing the weekly awards recap for the group chat.
Voice: funny, savage but good-natured, high group-chat energy. Roast the losers, hype the winners.
Constraints:
- 150–250 words total.
- Mention every award, using its exact name (e.g. "The Juggernaut", "The Bonehead").
- Write award names in normal title case (e.g. "Baller of the Week"), never in all caps.
- Use the exact team names, player names, and point totals from the fact sheet. Never invent numbers or winners.
- Every number above ${MAX_FREE_NUMBER} must come from the fact sheet, as written or rounded to a whole number. Don't do your own math (the sheet has the margins), and no percentages, years or other stats.
- Only say a bench or start/sit mistake cost a team the game when the fact sheet says so. If they still won, roast them for getting away with it.
- If the fact sheet has a "Season so far" section, you may add a callback or two about it (e.g. a team's third Corpse). Keep the focus on this week, and only use season counts that appear in the sheet.
- Plain text suitable for pasting into WhatsApp. A few emojis are fine. No markdown headings, no bullet characters like "*".`;

const ANALYST_PROMPT = `You help the fantasy football league's master roaster plan the weekly roast for the group chat.
From the fact sheet, pick the 3 or 4 best storylines: the funniest contrasts, the most painful losses,
repeat winners from the "Season so far" section, and anyone who appears in more than one award.
Each storyline is one short sentence that uses only facts from the sheet. Don't write jokes yet.`;

const CHECKER_PROMPT = `You fact-check a fantasy football roast before it goes to the group chat.
Compare the draft with the fact sheet and reject it if any of these are true:
- An award is given to the wrong team or player, or a team or player is credited with something they didn't do.
- A number, season count or result doesn't match the sheet.
- It says a mistake cost a team the game, or that a team won or lost, when the sheet says otherwise.
- An award from the sheet is missing.
- It's clearly outside 150–250 words.
Jokes, exaggeration and insults are fine as long as the facts are right. List each problem as one short,
specific sentence the writer can act on. Approve with no issues if the draft is accurate.`;

const STORYLINES_FORMAT = jsonSchemaOutputFormat({
  type: 'object',
  properties: { storylines: { type: 'array', items: { type: 'string' } } },
  required: ['storylines'],
  additionalProperties: false,
});

const VERDICT_FORMAT = jsonSchemaOutputFormat({
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['approved', 'issues'],
  additionalProperties: false,
});

interface Call {
  system: string;
  user: string;
}

const BASE_PARAMS = {
  max_tokens: 4096,
} as const;

function assertFinished(message: Anthropic.Message): void {
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'refusal') {
    throw new Error(`Claude did not finish (stop_reason: ${message.stop_reason}).`);
  }
}

/** One plain-text Claude call. Throws if it doesn't finish or comes back empty. */
export async function callClaude(client: Anthropic, model: string, { system, user }: Call): Promise<string> {
  const message = await client.messages.create({
    ...BASE_PARAMS,
    model,
    // A short roast doesn't need deep reasoning; low effort is faster and cheaper.
    output_config: { effort: 'low' },
    system,
    messages: [{ role: 'user', content: user }],
  });
  assertFinished(message);

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) throw new Error('Claude returned an empty response.');
  return text;
}

function writerPrompt(sheet: string, storylines: string[], revision?: Revision): string {
  const parts = [sheet];
  if (storylines.length > 0) {
    parts.push('', 'Storylines to build the roast around:', ...storylines.map((storyline) => `- ${storyline}`));
  }
  if (revision) {
    parts.push(
      '',
      'Your previous draft was rejected. Rewrite it and fix every issue below.',
      'Issues:',
      ...revision.issues.map((issue) => `- ${issue}`),
      '',
      'Previous draft:',
      revision.draft,
    );
  }
  return parts.join('\n');
}

/** The real agents, each backed by a Claude call. */
export function claudeAgents(client: Anthropic, model: string): Agents {
  return {
    async analyst(sheet) {
      const message = await client.messages.parse({
        ...BASE_PARAMS,
        model,
        output_config: { effort: 'low', format: STORYLINES_FORMAT },
        system: ANALYST_PROMPT,
        messages: [{ role: 'user', content: sheet }],
      });
      assertFinished(message);
      if (!message.parsed_output) throw new Error('The analyst returned no storylines.');
      return message.parsed_output.storylines;
    },

    writer(sheet, storylines, revision) {
      return callClaude(client, model, { system: ROAST_PROMPT, user: writerPrompt(sheet, storylines, revision) });
    },

    async checker(sheet, draft) {
      const message = await client.messages.parse({
        ...BASE_PARAMS,
        model,
        output_config: { effort: 'low', format: VERDICT_FORMAT },
        system: CHECKER_PROMPT,
        messages: [{ role: 'user', content: `Fact sheet:\n${sheet}\n\nDraft:\n${draft}` }],
      });
      assertFinished(message);
      if (!message.parsed_output) throw new Error('The checker returned no verdict.');
      return message.parsed_output;
    },
  };
}
