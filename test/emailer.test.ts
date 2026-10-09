import { describe, it, expect } from 'vitest';
import { failureAlertContent } from '../src/emailer.js';

const main = { id: 'main', displayName: 'Main League' };

describe('failureAlertContent', () => {
  it('names the league and its id, and shows the error', () => {
    const { subject, text } = failureAlertContent(main, new Error('No matchups returned for Week 5'));
    expect(subject).toBe('⚠️ Fantasy recap FAILED (Main League)');
    expect(text).toContain('The fantasy recap for Main League (id "main") did not send.');
    expect(text).toContain('Error: No matchups returned for Week 5');
  });

  it('leaves out the cookie steps when the cookies are not the problem', () => {
    const { text } = failureAlertContent(main, new Error('boom'));
    expect(text).not.toContain('HOW TO FIX THE COOKIES');
  });

  it('adds the cookie steps for every entry on the account when ESPN rejected the cookies', () => {
    const { text } = failureAlertContent(main, new Error('Request failed with status code 401'), undefined, {
      accounts: [['main', 'second']],
      missing: [],
    });
    expect(text).toContain('ESPN rejected the cookies, so they have probably expired.');
    expect(text).toContain('HOW TO FIX THE COOKIES');
    expect(text).toContain('Update espnS2 and swid for main, second.');
    expect(text).toContain('gh workflow run weekly-recap.yml');
    expect(text).toContain("re-sends every league's recap");
  });

  it('ends with the run link when there is one', () => {
    const { text } = failureAlertContent(main, new Error('boom'), 'https://github.com/x/y/actions/runs/1');
    expect(text.endsWith('Run: https://github.com/x/y/actions/runs/1')).toBe(true);
  });
});
