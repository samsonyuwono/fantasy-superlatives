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

/** Notify the owner (not the friend group) that one league's recap failed to send. */
export async function sendFailureAlert(opts: {
  apiKey: string;
  from: string;
  ownerEmail: string;
  leagueId: string;
  error: Error;
  runUrl?: string;
}): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const lines = [
    `The fantasy recap for league "${opts.leagueId}" did not send.`,
    '',
    `Error: ${opts.error.message}`,
  ];
  if (opts.runUrl) lines.push('', `Run: ${opts.runUrl}`);

  const { error } = await resend.emails.send({
    from: opts.from,
    to: opts.ownerEmail,
    subject: `⚠️ Fantasy recap FAILED (${opts.leagueId})`,
    text: lines.join('\n'),
  });
  if (error) {
    throw new Error(`Resend failed to send failure alert: ${error.name} — ${error.message}`);
  }
}
