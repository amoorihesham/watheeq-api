export interface EmailMessageType {
  to: string;
  subject: string;
  text: string;
}

/** The only thing modules depend on for email; the SMTP sender implements it, and tests pass a fake. */
export interface EmailSenderType {
  send(message: EmailMessageType): Promise<void>;
}

export interface SmtpSettingsType {
  host: string;
  port: number;
  secure: boolean;
  user: string | undefined;
  password: string | undefined;
  from: string;
}
