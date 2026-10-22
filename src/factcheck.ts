/**
 * Deterministic checks on a roast draft, run before the Claude checker. It's free, and it can't be
 * talked out of a wrong number.
 */
import { AWARDS } from './awards.js';

const AWARD_NAMES = Object.values(AWARDS)
  .filter((award) => award.requiredInRoast)
  .map((award) => award.name);
// Matched in title case as whole words, so the verb "robbed" doesn't count as the Robbed award.
// A leading "The" is optional: "this week's Juggernaut" names The Juggernaut.
const AWARD_PATTERNS = AWARD_NAMES.map((name) => ({ name, pattern: new RegExp(`\\b${name.replace(/^The /, '')}\\b`) }));
const NUMBER = /\d+(?:\.\d+)?/g;
// Small counts ("2 teams", "Week 5", "3rd") read naturally and can't hide a wrong score.
export const MAX_FREE_NUMBER = 10;

/** Whether a draft number matches a sheet number. A whole number may round or drop the decimal ("88" or "87" for 87.6). */
function matches(raw: string, sheetValue: number): boolean {
  const value = Number(raw);
  if (raw.includes('.')) return Math.abs(sheetValue - value) < 0.05;
  return Math.round(sheetValue) === value || Math.trunc(sheetValue) === value;
}

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number);
}

/** Problems with the draft, one short sentence each. Empty means it passed. */
export function verifyDraft(draft: string, sheet: string): string[] {
  const issues: string[] = [];

  const allowed = numbersIn(sheet);
  const unknown = new Set<string>();
  for (const raw of draft.match(NUMBER) ?? []) {
    if (Number(raw) <= MAX_FREE_NUMBER) continue;
    if (!allowed.some((sheetValue) => matches(raw, sheetValue))) unknown.add(raw);
  }
  for (const raw of unknown) issues.push(`The number ${raw} isn't in the fact sheet. Use a number from the sheet or cut it.`);

  for (const { name, pattern } of AWARD_PATTERNS) {
    if (!pattern.test(draft)) issues.push(`The award "${name}" is missing. Name it as written, in title case.`);
  }

  return issues;
}
