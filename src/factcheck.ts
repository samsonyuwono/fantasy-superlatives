import { AWARDS } from './awards.js';

const AWARD_NAMES = Object.values(AWARDS)
  .filter((award) => award.requiredInRoast)
  .map((award) => award.name);
const withoutLeadingThe = (name: string) => name.replace(/^The /, '');
const caseSensitiveWholeWord = (text: string) => new RegExp(`\\b${text}\\b`);
const AWARD_PATTERNS = AWARD_NAMES.map((name) => ({ name, pattern: caseSensitiveWholeWord(withoutLeadingThe(name)) }));
const NUMBER = /\d+(?:\.\d+)?/g;
/**
 * Numbers up to this skip the check: small counts ("2 teams", "Week 5", "3rd") read naturally
 * and can't hide a wrong score.
 */
export const MAX_FREE_NUMBER = 10;

function matchesSheetValue(raw: string, sheetValue: number): boolean {
  const value = Number(raw);
  if (raw.includes('.')) return Math.abs(sheetValue - value) < 0.05;
  return Math.round(sheetValue) === value || Math.trunc(sheetValue) === value;
}

function numbersIn(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number);
}

/**
 * Problems with the draft, one short sentence each. Empty means it passed. These deterministic
 * checks run before the Claude checker: they're free, and can't be talked out of a wrong number.
 * A whole number may round or drop the decimal of a sheet number ("88" or "87" for 87.6). Award
 * names must appear in title case as whole words, so the verb "robbed" doesn't count as the Robbed
 * award, and a leading "The" is optional: "this week's Juggernaut" names The Juggernaut.
 */
export function verifyDraft(draft: string, sheet: string): string[] {
  const issues: string[] = [];

  const allowed = numbersIn(sheet);
  const unknown = new Set<string>();
  for (const raw of draft.match(NUMBER) ?? []) {
    if (Number(raw) <= MAX_FREE_NUMBER) continue;
    if (!allowed.some((sheetValue) => matchesSheetValue(raw, sheetValue))) unknown.add(raw);
  }
  for (const raw of unknown) issues.push(`The number ${raw} isn't in the fact sheet. Use a number from the sheet or cut it.`);

  for (const { name, pattern } of AWARD_PATTERNS) {
    if (!pattern.test(draft)) issues.push(`The award "${name}" is missing. Name it as written, in title case.`);
  }

  return issues;
}
