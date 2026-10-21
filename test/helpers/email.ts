import type { EmailMessageType, EmailSenderType } from "../../src/email/index.js";

/** Records every email instead of sending it. `failNext` makes the next send throw, like an SMTP outage. */
export function createFakeEmailSender() {
  const sent: EmailMessageType[] = [];
  let failNext = false;
  const sender: EmailSenderType = {
    async send(message) {
      if (failNext) {
        failNext = false;
        throw new Error("smtp unavailable");
      }
      sent.push(message);
    },
  };
  return {
    sender,
    sent,
    failNext: () => {
      failNext = true;
    },
    /** The token in the last verification link emailed to an address. */
    lastTokenFor(to: string): string {
      const message = sent.filter((m) => m.to === to).at(-1);
      const link = message?.text.match(/https?:\/\/\S+/)?.[0];
      return link ? (new URL(link).searchParams.get("token") ?? "") : "";
    },
  };
}
