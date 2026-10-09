/**
 * Sends the recap via the Resend API — no personal mailbox or SMTP sender required.
 */
import { Resend } from 'resend';

export interface SendOptions {
  apiKey: string;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
}

/** Send the recap email. Throws if Resend reports an error. */
export async function sendRecap(opts: SendOptions): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const { error } = await resend.emails.send({
    from: opts.from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
  if (error) {
    throw new Error(`Resend failed to send: ${error.name} — ${error.message}`);
  }
}

/** How alerts name a league: its display name, plus the id that keys its cookies in LEAGUE_SECRETS_JSON. */
export interface AlertLeague {
  id: string;
  displayName: string;
}

/**
 * Subject and text for a failed recap. Pass `fixes` when ESPN rejected the cookies, to add the
 * steps for refreshing them and re-sending the recap.
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
export async function sendFailureAlert(opts: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  league: AlertLeague;
  error: Error;
  runUrl?: string;
  fixes?: SecretFixes;
}): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const { subject, text } = failureAlertContent(opts.league, opts.error, opts.runUrl, opts.fixes);
  const { error } = await resend.emails.send({ from: opts.from, to: opts.ownerEmail, subject, text });
  if (error) {
    throw new Error(`Resend failed to send failure alert: ${error.name} — ${error.message}`);
  }
}

/** Why a league failed the Monday check, which decides what the alert tells the owner to do. */
export type FailureKind = 'cookies' | 'unclear' | 'missing-secret' | 'other';

export interface CheckFailure {
  league: AlertLeague;
  error: Error;
  kind: FailureKind;
}

/**
 * The LEAGUE_SECRETS_JSON entries to fix. `accounts` groups the entries to refresh by ESPN
 * account, since each league keeps its own copy of an account's cookies; `missing` needs adding.
 */
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

const KIND_LABEL: Record<FailureKind, string> = {
  cookies: 'Cookies rejected',
  unclear: 'Unexpected response from ESPN (may be the cookies)',
  'missing-secret': 'No entry in LEAGUE_SECRETS_JSON',
  other: 'Not a cookie problem',
};

function secretFixItems(fixes: SecretFixes): string[] {
  return [
    ...fixes.accounts.map((ids) =>
      ids.length > 1
        ? `Update espnS2 and swid for ${ids.join(', ')}. They use the same ESPN account, so they all need the new cookies.`
        : `Update espnS2 and swid for ${ids[0]}.`,
    ),
    ...fixes.missing.map((id) => `Add an entry for ${id}: "${id}": { "espnS2": "...", "swid": "{...}" }`),
  ];
}

/** Steps for refreshing or adding cookies in LEAGUE_SECRETS_JSON. */
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CODE_STYLE = 'display:inline-block;margin-top:4px;padding:4px 8px;background:#f3f4f6;border-radius:4px;font-family:Menlo,Consolas,monospace;font-size:13px';
const NOTE_STYLE = 'color:#6b7280;font-size:13px';
const HEADING_STYLE = 'margin:24px 0 8px;font-size:15px';

function stepsText(steps: FixStep[], numbered: boolean): string[] {
  return steps.flatMap((s, i) => [
    numbered ? `${i + 1}. ${s.text}` : s.text,
    ...(s.command ? [`     ${s.command}`] : []),
    ...(s.items ?? []).map((item) => `   - ${item}`),
    ...(s.note ? [`   ${s.note}`] : []),
  ]);
}

function stepsHtml(steps: FixStep[], numbered: boolean): string[] {
  const tag = numbered ? 'ol' : 'ul';
  const listStyle = numbered ? 'padding-left:20px;margin:0' : 'padding-left:0;margin:0;list-style:none';
  return [
    `<${tag} style="${listStyle}">`,
    ...steps.map(
      (s) =>
        `<li style="margin-bottom:10px">${escapeHtml(s.text)}` +
        (s.command ? `<br><code style="${CODE_STYLE}">${escapeHtml(s.command)}</code>` : '') +
        (s.items?.length
          ? `<ul style="padding-left:20px;margin:4px 0 0">${s.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
          : '') +
        (s.note ? `<br><span style="${NOTE_STYLE}">${escapeHtml(s.note)}</span>` : '') +
        '</li>',
    ),
    `</${tag}>`,
  ];
}

/** Subject, plain text and HTML for the Monday check alert, all built from the same content. */
export function espnCheckAlertContent(
  failures: CheckFailure[],
  fixes: SecretFixes,
  runUrl?: string,
): { subject: string; text: string; html: string } {
  const names = failures.map((f) => f.league.displayName).join(', ');
  const allCookies = failures.every((f) => f.kind === 'cookies');
  const subject = allCookies ? `⚠️ ESPN cookies may have expired (${names})` : `⚠️ ESPN check failed (${names})`;
  const count = failures.length === 1 ? '1 league' : `${failures.length} leagues`;
  const intro = `The ESPN check failed for ${count}. The next recap for ${failures.length === 1 ? 'it' : 'them'} will fail unless this is fixed.`;

  const sections: { heading: string; steps: FixStep[]; numbered: boolean }[] = [];
  if (fixes.accounts.length > 0 || fixes.missing.length > 0) {
    sections.push({ heading: 'How to fix the cookies', steps: cookieFixSteps(fixes), numbered: true });
  }
  if (failures.some((f) => f.kind === 'unclear')) {
    sections.push({ heading: 'Unexpected response from ESPN', steps: UNCLEAR_FAILURE_STEPS, numbered: false });
  }
  if (failures.some((f) => f.kind === 'other')) {
    sections.push({ heading: 'Not a cookie problem', steps: OTHER_FAILURE_STEPS, numbered: false });
  }

  const text = [
    intro,
    '',
    'WHICH LEAGUES FAILED',
    ...failures.flatMap((f) => [
      `• ${f.league.displayName} (id: ${f.league.id}): ${KIND_LABEL[f.kind]}`,
      `  ${f.error.message}`,
    ]),
    ...sections.flatMap((s) => ['', s.heading.toUpperCase(), ...stepsText(s.steps, s.numbered)]),
    ...(runUrl ? ['', `View the run: ${runUrl}`] : []),
  ].join('\n');

  const html = [
    '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;max-width:640px">',
    `<p>${escapeHtml(intro)}</p>`,
    `<h3 style="${HEADING_STYLE}">Which leagues failed</h3>`,
    '<ul style="padding-left:20px;margin:0">',
    ...failures.map(
      (f) =>
        `<li style="margin-bottom:8px"><strong>${escapeHtml(f.league.displayName)}</strong> <span style="${NOTE_STYLE}">(id: ${escapeHtml(f.league.id)})</span>: ${escapeHtml(KIND_LABEL[f.kind])}<br><span style="${NOTE_STYLE}">${escapeHtml(f.error.message)}</span></li>`,
    ),
    '</ul>',
    ...sections.flatMap((s) => [`<h3 style="${HEADING_STYLE}">${escapeHtml(s.heading)}</h3>`, ...stepsHtml(s.steps, s.numbered)]),
    ...(runUrl ? [`<p style="margin-top:24px"><a href="${escapeHtml(runUrl)}">View the run on GitHub</a></p>`] : []),
    '</div>',
  ].join('\n');

  return { subject, text, html };
}

/** Warn the owner, ahead of Tuesday's run, that one or more leagues failed the ESPN check. Throws if Resend reports an error. */
export async function sendEspnCheckAlert(opts: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  failures: CheckFailure[];
  fixes: SecretFixes;
  runUrl?: string;
}): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const { subject, text, html } = espnCheckAlertContent(opts.failures, opts.fixes, opts.runUrl);
  const { error } = await resend.emails.send({ from: opts.from, to: opts.ownerEmail, subject, text, html });
  if (error) {
    throw new Error(`Resend failed to send ESPN check alert: ${error.name} — ${error.message}`);
  }
}

/** Tell the owner a league's recap went out without its season leaderboard. Throws if Resend reports an error. */
export async function sendLeaderboardSkippedAlert(opts: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  league: AlertLeague;
  error: Error;
  runUrl?: string;
}): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const lines = [
    `The fantasy recap for ${opts.league.displayName} (id "${opts.league.id}") was sent, but without the season leaderboard.`,
    '',
    `Error: ${opts.error.message}`,
  ];
  if (opts.runUrl) lines.push('', `Run: ${opts.runUrl}`);

  const { error } = await resend.emails.send({
    from: opts.from,
    to: opts.ownerEmail,
    subject: `⚠️ Fantasy recap sent without leaderboard (${opts.league.displayName})`,
    text: lines.join('\n'),
  });
  if (error) {
    throw new Error(`Resend failed to send leaderboard alert: ${error.name} — ${error.message}`);
  }
}
