import { appendFileSync } from 'node:fs';

/** Read a required environment variable. Throws with its name if it's missing or empty. */
export function required(name: string, environment: NodeJS.ProcessEnv = process.env): string {
  const value = environment[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** The link to the current GitHub Actions run, or undefined when not running in Actions. */
export function githubRunUrl(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = environment;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return undefined;
  return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
}

/** Set a step output for later workflow steps to read. Does nothing outside GitHub Actions. */
export function setGithubOutput(name: string, value: string, environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, `${name}=${value}\n`);
}
