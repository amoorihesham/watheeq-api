import nodemailer from "nodemailer";
import type { EmailSenderType, SmtpSettingsType } from "./email.types.js";

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
