import { AWARDS } from './awards.js';

const AWARD_NAMES = Object.values(AWARDS)
  .filter((award) => award.requiredInRoast)
  .map((award) => award.name);
const withoutLeadingThe = (name: string) => name.replace(/^The /, '');
const caseSensitiveWholeWord = (text: string) => new RegExp(`\\b${text}\\b`);
const AWARD_PATTERNS = AWARD_NAMES.map((name) => ({ name, pattern: caseSensitiveWholeWord(withoutLeadingThe(name)) }));
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
/**
 * Numbers up to this skip the check: small counts ("2 teams", "Week 5", "3rd") read naturally
 * and can't hide a wrong score.
 */
export const MAX_FREE_NUMBER = 10;

function matchesSheetValue(draftNumber: string, sheetValue: number): boolean {
  const value = Number(draftNumber);
  if (draftNumber.includes('.')) return Math.abs(sheetValue - value) < 0.05;
  return Math.round(sheetValue) === value || Math.trunc(sheetValue) === value;
}

function numbersIn(text: string): number[] {
  return (text.match(NUMBER_PATTERN) ?? []).map(Number);
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

  const sheetNumbers = numbersIn(sheet);
  const unknownNumbers = new Set<string>();
  for (const draftNumber of draft.match(NUMBER_PATTERN) ?? []) {
    if (Number(draftNumber) <= MAX_FREE_NUMBER) continue;
    if (!sheetNumbers.some((sheetValue) => matchesSheetValue(draftNumber, sheetValue))) unknownNumbers.add(draftNumber);
  }
  for (const draftNumber of unknownNumbers) issues.push(`The number ${draftNumber} isn't in the fact sheet. Use a number from the sheet or cut it.`);

  for (const { name, pattern } of AWARD_PATTERNS) {
    if (!pattern.test(draft)) issues.push(`The award "${name}" is missing. Name it as written, in title case.`);
  }

  return issues;
}
