import nodemailer from "nodemailer";
import type { Config } from "@/config/config.js";
import type { EmailSenderType, SmtpSettingsType } from "./email.types.js";

export function smtpSettingsOf(config: Config): SmtpSettingsType {
  return {
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    user: config.SMTP_USER,
    password: config.SMTP_PASSWORD,
    from: config.EMAIL_FROM,
  };
}

export function createSmtpSender(settings: SmtpSettingsType): EmailSenderType {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && settings.password
      ? { auth: { user: settings.user, pass: settings.password } }
      : {}),
  });
  return {
    async send(message) {
      await transport.sendMail({ from: settings.from, ...message });
    },
  };
}
