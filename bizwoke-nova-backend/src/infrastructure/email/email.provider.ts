import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ providerMessageId?: string }>;
}

class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private transport: Transporter;
  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(msg: EmailMessage) {
    const info = await this.transport.sendMail({ from: this.from, ...msg });
    return { providerMessageId: info.messageId };
  }
}

let override: EmailProvider | null | undefined;
let cached: EmailProvider | null | undefined;

/** Returns null when no email provider is configured — callers must handle "unavailable". */
export function getEmailProvider(): EmailProvider | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const e = env();
  cached =
    e.EMAIL_PROVIDER === 'smtp' && e.SMTP_URL && e.EMAIL_FROM
      ? new SmtpEmailProvider(e.SMTP_URL, e.EMAIL_FROM)
      : null;
  return cached;
}

export function setEmailProviderForTests(p: EmailProvider | null | undefined): void {
  override = p;
}
