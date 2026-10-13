import { describe, it, expect } from 'vitest';
import { verifyDraft } from '../src/factcheck.js';

const sheet = [
  'Week 5 fantasy football results.',
  '- The Juggernaut (highest team score): Bravo — 120.0 pts',
  '- The Corpse (lowest team score): Jurong FC — 87.6 pts',
  '- Baller of the Week (top individual starter): Puka Nacua on Alpha — 31.4 pts',
  'Season so far (Weeks 1–5):',
  '- Jurong FC has now won The Corpse 3 times this season (including this week).',
].join('\n');

const allAwards =
  'The Juggernaut, The Corpse, Baller of the Week, The Sleepwalker, The Bonehead, Backed Into It and Robbed.';

describe('verifyDraft', () => {
  it('passes a draft that only uses numbers from the sheet', () => {
    expect(verifyDraft(`Bravo dropped 120.0 and Puka had 31.4. ${allAwards}`, sheet)).toEqual([]);
  });

  it('flags a number that is not in the sheet', () => {
    expect(verifyDraft(`Bravo dropped 134.5! ${allAwards}`, sheet)).toEqual(["The number 134.5 isn't in the fact sheet."]);
  });

  it('flags a wrong decimal even when it is close', () => {
    expect(verifyDraft(`Jurong FC scored 87.9. ${allAwards}`, sheet)).toEqual(["The number 87.9 isn't in the fact sheet."]);
  });

  it('accepts whole numbers that round or drop the decimal', () => {
    expect(verifyDraft(`Bravo hit 120, Jurong FC managed 88 (well, 87). ${allAwards}`, sheet)).toEqual([]);
  });

  it('allows small counts like "3 times" and "Week 5"', () => {
    expect(verifyDraft(`Week 5: Jurong FC's 3rd Corpse in 2 months. ${allAwards}`, sheet)).toEqual([]);
  });

  it('reports each unknown number once', () => {
    expect(verifyDraft(`99 points, yes 99. ${allAwards}`, sheet)).toEqual(["The number 99 isn't in the fact sheet."]);
  });

  it('flags missing awards, ignoring case', () => {
    const draft = 'the juggernaut, The Corpse, Baller of the Week, The Sleepwalker, The Bonehead and Robbed.';
    expect(verifyDraft(draft, sheet)).toEqual(['The award "Backed Into It" is missing.']);
  });
});
