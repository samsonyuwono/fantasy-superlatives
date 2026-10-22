import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { NINE_AM_RUN_TITLE, newYorkDate, shouldSkipFallback, type WorkflowRun } from '../src/guard.js';

const FALLBACK_AT_TUESDAY_3PM_EDT = new Date('2026-10-13T19:00:00Z');

const nineAmRun = (createdAt: string): WorkflowRun => ({ displayTitle: NINE_AM_RUN_TITLE, createdAt });

describe('newYorkDate', () => {
  it('uses the New York calendar date, not UTC (01:30 UTC on the 14th is 9:30pm on the 13th)', () => {
    expect(newYorkDate(new Date('2026-10-14T01:30:00Z'))).toBe('2026-10-13');
  });

  it('handles standard time (EST) after DST ends (04:30 UTC on Nov 10 is 11:30pm on Nov 9)', () => {
    expect(newYorkDate(new Date('2026-11-10T04:30:00Z'))).toBe('2026-11-09');
  });
});

describe('shouldSkipFallback', () => {
  it('never skips a manual or external dispatch', () => {
    const runs = [nineAmRun('2026-10-13T13:00:05Z')];
    expect(shouldSkipFallback('workflow_dispatch', runs, FALLBACK_AT_TUESDAY_3PM_EDT)).toBe(false);
  });

  it('skips the scheduled fallback when today\'s 9am run exists', () => {
    const runs = [nineAmRun('2026-10-13T13:00:05Z')];
    expect(shouldSkipFallback('schedule', runs, FALLBACK_AT_TUESDAY_3PM_EDT)).toBe(true);
  });

  it('runs the fallback when the 9am trigger never fired today', () => {
    expect(shouldSkipFallback('schedule', [], FALLBACK_AT_TUESDAY_3PM_EDT)).toBe(false);
  });

  it('ignores last week\'s 9am run', () => {
    const runs = [nineAmRun('2026-10-06T13:00:05Z')];
    expect(shouldSkipFallback('schedule', runs, FALLBACK_AT_TUESDAY_3PM_EDT)).toBe(false);
  });

  it('ignores other runs from today (manual tests, earlier fallbacks)', () => {
    const runs: WorkflowRun[] = [
      { displayTitle: 'Weekly Superlatives Recap', createdAt: '2026-10-13T12:00:00Z' },
    ];
    expect(shouldSkipFallback('schedule', runs, FALLBACK_AT_TUESDAY_3PM_EDT)).toBe(false);
  });

  it('matches the 9am run when the fallback is delayed past UTC midnight (9:30pm EDT)', () => {
    const runs = [nineAmRun('2026-10-13T13:00:05Z')];
    expect(shouldSkipFallback('schedule', runs, new Date('2026-10-14T01:30:00Z'))).toBe(true);
  });
});

describe('workflow wiring', () => {
  it('labels external runs with the exact title the guard looks for', () => {
    const workflow = readFileSync(new URL('../.github/workflows/weekly-recap.yml', import.meta.url), 'utf8');
    expect(workflow).toContain(`'${NINE_AM_RUN_TITLE}'`);
    expect(workflow).toContain("inputs.source == 'external-9am'");
  });
});
