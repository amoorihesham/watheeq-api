import nodemailer from 'nodemailer';
import type { EmailSenderType, SmtpSettingsType } from './email.types.js';

export function createSmtpSender(settings: SmtpSettingsType): EmailSenderType {
  const transport = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.smtpSecure,
    ...(settings.smtpUser && settings.smtpPassword ? { auth: { user: settings.smtpUser, pass: settings.smtpPassword } } : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: settings.emailFrom, ...message });
    },
  };
}
