import { Resend } from 'resend';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  messageId: string | null;
}

export interface EmailTransport {
  readonly name: 'resend' | 'console';
  send(message: EmailMessage): Promise<SendResult>;
}

/**
 * Used whenever RESEND_API_KEY is absent.
 *
 * The alert pipeline — threshold selection, the claim-then-send dedupe, the
 * rendered digest — is fully exercisable offline this way. Silently skipping
 * the send instead would leave the most failure-prone part of the feature
 * untested until it ran against real mail.
 */
class ConsoleEmailTransport implements EmailTransport {
  readonly name = 'console' as const;

  async send(message: EmailMessage): Promise<SendResult> {
    logger.info(
      { to: message.to, from: message.from, subject: message.subject, body: message.text },
      'email (console transport — set RESEND_API_KEY to actually send)',
    );
    return { messageId: `console-${Date.now()}` };
  }
}

class ResendEmailTransport implements EmailTransport {
  readonly name = 'resend' as const;
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const { data, error } = await this.client.emails.send({
      to: message.to,
      from: message.from,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    // Resend reports failures in the response body rather than by throwing, so
    // an unchecked call looks successful while delivering nothing.
    if (error) throw new Error(`Resend rejected the message: ${error.message}`);
    return { messageId: data?.id ?? null };
  }
}

export function createEmailTransport(): EmailTransport {
  const apiKey = env.RESEND_API_KEY?.trim();
  return apiKey ? new ResendEmailTransport(apiKey) : new ConsoleEmailTransport();
}
