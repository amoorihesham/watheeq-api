import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH } from "../src/modules/auth/auth.config.js";
import { hashPassword, verifyPassword } from "../src/modules/auth/shared/passwords.js";

describe("passwords", () => {
  it("hashes with argon2id at the OWASP minimum parameters and verifies", async () => {
    const hash = await hashPassword("a password");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "a password")).toBe(true);
    expect(await verifyPassword(hash, "another")).toBe(false);
  });

  it("treats a malformed stored hash as a mismatch", async () => {
    expect(await verifyPassword("not a hash", "x")).toBe(false);
  });

  it("keeps the dummy hash valid and in line with the real parameters", async () => {
    const real = await hashPassword("x");
    const params = (hash: string) => hash.split("$").slice(1, 4);
    expect(params(DUMMY_PASSWORD_HASH)).toEqual(params(real));
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, "x")).toBe(false);
  });
});
