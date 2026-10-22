import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { required, githubRunUrl, setGithubOutput } from '../src/env.js';

describe('required', () => {
  it('returns the value when it is set', () => {
    expect(required('RESEND_API_KEY', { RESEND_API_KEY: 're_123' })).toBe('re_123');
  });

  it('throws with the variable name when it is missing or empty', () => {
    expect(() => required('RESEND_API_KEY', {})).toThrow('Missing required environment variable: RESEND_API_KEY');
    expect(() => required('RESEND_API_KEY', { RESEND_API_KEY: '' })).toThrow('RESEND_API_KEY');
  });
});

describe('githubRunUrl', () => {
  it('builds the run link inside GitHub Actions', () => {
    const actionsEnvironment = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'me/repo', GITHUB_RUN_ID: '42' };
    expect(githubRunUrl(actionsEnvironment)).toBe('https://github.com/me/repo/actions/runs/42');
  });

  it('returns undefined outside Actions, or when any part is missing', () => {
    expect(githubRunUrl({})).toBeUndefined();
    expect(githubRunUrl({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'me/repo' })).toBeUndefined();
  });
});

describe('setGithubOutput', () => {
  it('appends name=value to the GITHUB_OUTPUT file', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gh-output-')), 'output');
    setGithubOutput('alerted', 'true', { GITHUB_OUTPUT: file });
    setGithubOutput('skip', 'false', { GITHUB_OUTPUT: file });
    expect(readFileSync(file, 'utf8')).toBe('alerted=true\nskip=false\n');
  });

  it('does nothing outside GitHub Actions', () => {
    expect(() => setGithubOutput('alerted', 'true', {})).not.toThrow();
  });
});
