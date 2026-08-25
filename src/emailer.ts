/**
 * Sends the recap via the Resend API — no personal mailbox or SMTP sender required.
 */
import { Resend } from 'resend';

export interface SendOptions {
  apiKey: string;
  from: string;
  to: string;
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
