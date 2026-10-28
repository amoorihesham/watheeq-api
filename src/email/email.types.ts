import type { EmailConfigType } from '@/config/config.js';

export interface EmailMessageType {
  to: string;
  subject: string;
  text: string;
}

/** The only thing modules depend on for email; the SMTP sender implements it, and tests pass a fake. */
export interface EmailSenderType {
  send(message: EmailMessageType): Promise<void>;
}

export type SmtpSettingsType = EmailConfigType;
