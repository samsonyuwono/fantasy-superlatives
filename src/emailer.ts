import { Resend } from 'resend';

export interface SendOptions {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
}

/**
 * Send the recap email through the Resend API, so no personal mailbox or SMTP sender is needed.
 * Throws if Resend reports an error.
 */
export async function sendRecap(options: SendOptions): Promise<void> {
  const resend = new Resend(options.apiKey);
  const { error } = await resend.emails.send({
    from: options.from,
    to: options.to,
    subject: options.subject,
    text: options.text,
  });
  if (error) {
    throw new Error(`Resend failed to send: ${error.name} — ${error.message}`);
  }
}

export interface AlertLeague {
  id: string;
  displayName: string;
}

/**
 * Subject and text for a failed recap. The league is named by its display name plus the id that keys
 * its cookies in LEAGUE_SECRETS_JSON. Pass `fixes` when ESPN rejected the cookies, to add the steps for
 * refreshing them and re-sending the recap.
 */
export function failureAlertContent(
  league: AlertLeague,
  error: Error,
  runUrl?: string,
  fixes?: SecretFixes,
): { subject: string; text: string } {
  const lines = [`The fantasy recap for ${league.displayName} (id "${league.id}") did not send.`, '', `Error: ${error.message}`];
  if (fixes) {
    lines.push(
      '',
      'ESPN rejected the cookies, so they have probably expired.',
      '',
      'HOW TO FIX THE COOKIES',
      ...stepsText(cookieFixSteps(fixes), true),
      '',
      'Once the cookies are fixed, re-send the recap:',
      '     gh workflow run weekly-recap.yml',
      "   This re-sends every league's recap, not just this one.",
    );
  }
  if (runUrl) lines.push('', `Run: ${runUrl}`);
  return { subject: `⚠️ Fantasy recap FAILED (${league.displayName})`, text: lines.join('\n') };
}

/** Notify the owner (not the friend group) that one league's recap failed to send. */
export async function sendFailureAlert(options: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  league: AlertLeague;
  error: Error;
  runUrl?: string;
  fixes?: SecretFixes;
}): Promise<void> {
  const resend = new Resend(options.apiKey);
  const { subject, text } = failureAlertContent(options.league, options.error, options.runUrl, options.fixes);
  const { error } = await resend.emails.send({ from: options.from, to: options.ownerEmail, subject, text });
  if (error) {
    throw new Error(`Resend failed to send failure alert: ${error.name} — ${error.message}`);
  }
}

export type FailureKind = 'cookies' | 'unclear' | 'missing-secret' | 'other';

export interface CheckFailure {
  league: AlertLeague;
  error: Error;
  kind: FailureKind;
}

export interface SecretFixes {
  accounts: string[][];
  missing: string[];
}

interface FixStep {
  text: string;
  command?: string;
  items?: string[];
  note?: string;
}

const FAILURE_KIND_LABEL: Record<FailureKind, string> = {
  cookies: 'Cookies rejected',
  unclear: 'Unexpected response from ESPN (may be the cookies)',
  'missing-secret': 'No entry in LEAGUE_SECRETS_JSON',
  other: 'Not a cookie problem',
};

function secretFixItems(fixes: SecretFixes): string[] {
  return [
    ...fixes.accounts.map((leagueIds) =>
      leagueIds.length > 1
        ? `Update espnS2 and swid for ${leagueIds.join(', ')}. They use the same ESPN account, so they all need the new cookies.`
        : `Update espnS2 and swid for ${leagueIds[0]}.`,
    ),
    ...fixes.missing.map((id) => `Add an entry for ${id}: "${id}": { "espnS2": "...", "swid": "{...}" }`),
  ];
}

/**
 * Steps for refreshing or adding cookies in LEAGUE_SECRETS_JSON. `fixes.accounts` groups the entries to
 * refresh by ESPN account, since each league keeps its own copy of an account's cookies;
 * `fixes.missing` lists the entries to add.
 */
export function cookieFixSteps(fixes: SecretFixes): FixStep[] {
  return [
    {
      text: 'Log in at https://fantasy.espn.com in your browser.',
      note: "If a league uses a friend's ESPN account, ask them for new cookies instead (see SETUP.md).",
    },
    {
      text: 'In DevTools, open Application → Cookies → espn.com and copy espn_s2 and SWID.',
      note: 'Keep the { } braces on SWID.',
    },
    { text: 'In your local .env, edit LEAGUE_SECRETS_JSON:', items: secretFixItems(fixes) },
    { text: 'Check locally:', command: 'npm run cookie-check -- --dry-run --force' },
    {
      text: 'Update the GitHub secret. Run this, then paste the full JSON from .env without the outer single quotes:',
      command: 'gh secret set LEAGUE_SECRETS_JSON',
      note: 'This replaces the whole secret, so include every league, not just the ones listed above.',
    },
    { text: 'Confirm in CI:', command: 'gh workflow run cookie-check.yml -f force=true' },
  ];
}

const UNCLEAR_FAILURE_STEPS: FixStep[] = [
  {
    text: "ESPN answered, but not with the league's settings. Partly accepted cookies can cause this, so these leagues are included in the cookie steps above.",
  },
  {
    text: "If fresh cookies don't fix it, ESPN may have changed its API. Check the run log for the full error.",
  },
];

const OTHER_FAILURE_STEPS: FixStep[] = [
  {
    text: "ESPN failed for a reason other than the cookies. Check that the league's leagueId and seasonYear in leagues.json are right, or whether ESPN is down.",
  },
  { text: 'Then re-run the check:', command: 'gh workflow run cookie-check.yml -f force=true' },
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CODE_STYLE = 'display:inline-block;margin-top:4px;padding:4px 8px;background:#f3f4f6;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px';
const NOTE_STYLE = 'color:#6b7280;font-size:13px';
const HEADING_STYLE = 'margin:24px 0 8px;font-size:15px';

function stepsText(steps: FixStep[], numbered: boolean): string[] {
  return steps.flatMap((step, i) => [
    numbered ? `${i + 1}. ${step.text}` : step.text,
    ...(step.command ? [`     ${step.command}`] : []),
    ...(step.items ?? []).map((item) => `   - ${item}`),
    ...(step.note ? [`   ${step.note}`] : []),
  ]);
}

function stepsHtml(steps: FixStep[], numbered: boolean): string[] {
  const listTag = numbered ? 'ol' : 'ul';
  const listStyle = numbered ? 'padding-left:20px;margin:0' : 'padding-left:0;margin:0;list-style:none';
  return [
    `<${listTag} style="${listStyle}">`,
    ...steps.map(
      (step) =>
        `<li style="margin-bottom:10px">${escapeHtml(step.text)}` +
        (step.command ? `<br><code style="${CODE_STYLE}">${escapeHtml(step.command)}</code>` : '') +
        (step.items?.length
          ? `<ul style="padding-left:20px;margin:4px 0 0">${step.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : '') +
        (step.note ? `<br><span style="${NOTE_STYLE}">${escapeHtml(step.note)}</span>` : '') +
        '</li>',
    ),
    `</${listTag}>`,
  ];
}

/**
 * Subject, plain text and HTML for the Monday check alert, all built from the same content. Each
 * failure's `kind` (why the league failed) decides what the alert tells the owner to do.
 */
export function espnCheckAlertContent(
  failures: CheckFailure[],
  fixes: SecretFixes,
  runUrl?: string,
): { subject: string; text: string; html: string } {
  const leagueNames = failures.map((failure) => failure.league.displayName).join(', ');
  const everyFailureIsCookies = failures.every((failure) => failure.kind === 'cookies');
  const subject = everyFailureIsCookies
    ? `⚠️ ESPN cookies may have expired (${leagueNames})`
    : `⚠️ ESPN check failed (${leagueNames})`;
  const leagueCount = failures.length === 1 ? '1 league' : `${failures.length} leagues`;
  const intro = `The ESPN check failed for ${leagueCount}. The next recap for ${failures.length === 1 ? 'it' : 'them'} will fail unless this is fixed.`;

  const sections: { heading: string; steps: FixStep[]; numbered: boolean }[] = [];
  if (fixes.accounts.length > 0 || fixes.missing.length > 0) {
    sections.push({ heading: 'How to fix the cookies', steps: cookieFixSteps(fixes), numbered: true });
  }
  if (failures.some((failure) => failure.kind === 'unclear')) {
    sections.push({ heading: 'Unexpected response from ESPN', steps: UNCLEAR_FAILURE_STEPS, numbered: false });
  }
  if (failures.some((failure) => failure.kind === 'other')) {
    sections.push({ heading: 'Not a cookie problem', steps: OTHER_FAILURE_STEPS, numbered: false });
  }

  const text = [
    intro,
    '',
    'WHICH LEAGUES FAILED',
    ...failures.flatMap((failure) => [
      `• ${failure.league.displayName} (id: ${failure.league.id}): ${FAILURE_KIND_LABEL[failure.kind]}`,
      `  ${failure.error.message}`,
    ]),
    ...sections.flatMap((section) => ['', section.heading.toUpperCase(), ...stepsText(section.steps, section.numbered)]),
    ...(runUrl ? ['', `View the run: ${runUrl}`] : []),
  ].join('\n');

  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;max-width:640px">',
    `<p>${escapeHtml(intro)}</p>`,
    `<h3 style="${HEADING_STYLE}">Which leagues failed</h3>`,
    '<ul style="padding-left:20px;margin:0">',
    ...failures.map(
      (failure) =>
        `<li style="margin-bottom:8px"><strong>${escapeHtml(failure.league.displayName)}</strong> <span style="${NOTE_STYLE}">(id: ${escapeHtml(failure.league.id)})</span>: ${escapeHtml(FAILURE_KIND_LABEL[failure.kind])}<br><span style="${NOTE_STYLE}">${escapeHtml(failure.error.message)}</span></li>`,
    ),
    '</ul>',
    ...sections.flatMap((section) => [
      `<h3 style="${HEADING_STYLE}">${escapeHtml(section.heading)}</h3>`,
      ...stepsHtml(section.steps, section.numbered),
    ]),
    ...(runUrl ? [`<p style="margin-top:24px"><a href="${escapeHtml(runUrl)}">View the run on GitHub</a></p>`] : []),
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

/** Warn the owner, ahead of Tuesday's run, that one or more leagues failed the ESPN check. Throws if Resend reports an error. */
export async function sendEspnCheckAlert(options: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  failures: CheckFailure[];
  fixes: SecretFixes;
  runUrl?: string;
}): Promise<void> {
  const resend = new Resend(options.apiKey);
  const { subject, text, html } = espnCheckAlertContent(options.failures, options.fixes, options.runUrl);
  const { error } = await resend.emails.send({ from: options.from, to: options.ownerEmail, subject, text, html });
  if (error) {
    throw new Error(`Resend failed to send ESPN check alert: ${error.name} — ${error.message}`);
  }
}

/** Tell the owner a league's recap went out without its season leaderboard. Throws if Resend reports an error. */
export async function sendLeaderboardSkippedAlert(options: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  league: AlertLeague;
  error: Error;
  runUrl?: string;
}): Promise<void> {
  const resend = new Resend(options.apiKey);
  const lines = [
    `The fantasy recap for ${options.league.displayName} (id "${options.league.id}") was sent, but without the season leaderboard.`,
    '',
    `Error: ${options.error.message}`,
  ];
  if (options.runUrl) lines.push('', `Run: ${options.runUrl}`);

  const { error } = await resend.emails.send({
    from: options.from,
    to: options.ownerEmail,
    subject: `⚠️ Fantasy recap sent without leaderboard (${options.league.displayName})`,
    text: lines.join('\n'),
  });
  if (error) {
    throw new Error(`Resend failed to send leaderboard alert: ${error.name} — ${error.message}`);
  }
}
