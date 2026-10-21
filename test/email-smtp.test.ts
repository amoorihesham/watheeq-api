import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSmtpSender } from "../src/email/index.js";
import { verificationEmail } from "../src/modules/auth/index.js";

// The real SMTP path, against the same Mailpit image docker-compose.yml runs locally (Phase 1 spec, P1.18).
const MAILPIT_IMAGE = "axllent/mailpit:v1.27.10";

let mailpit: StartedTestContainer;
let apiBase = "";

beforeAll(async () => {
  mailpit = await new GenericContainer(MAILPIT_IMAGE)
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
  apiBase = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;
});

afterAll(async () => {
  await mailpit?.stop();
});

describe("SMTP sender through Mailpit", () => {
  it("delivers the verification email with its link", async () => {
    const sender = createSmtpSender({
      host: mailpit.getHost(),
      port: mailpit.getMappedPort(1025),
      secure: false,
      user: undefined,
      password: undefined,
      from: "Watheeq <no-reply@watheeq.test>",
    });
    const message = verificationEmail(
      { email: "sara@alnoor.sa", userName: "سارة القحطاني" },
      "a-test-token",
      "http://localhost:5173",
    );
    await sender.send(message);

    const list = (await (await fetch(`${apiBase}/messages`)).json()) as {
      messages: { ID: string; To: { Address: string }[]; Subject: string }[];
    };
    const delivered = list.messages.find((m) => m.To[0]?.Address === "sara@alnoor.sa");
    expect(delivered?.Subject).toBe(message.subject);

    const full = (await (await fetch(`${apiBase}/message/${delivered?.ID}`)).json()) as {
      From: { Address: string };
      Text: string;
    };
    expect(full.From.Address).toBe("no-reply@watheeq.test");
    expect(full.Text).toContain("http://localhost:5173/verify-email?token=a-test-token");
    expect(full.Text).toContain("سارة القحطاني");
  });
});
