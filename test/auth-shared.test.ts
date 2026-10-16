import { describe, expect, it } from "vitest";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../src/auth/shared/passwords.js";
import {
  generateToken,
  hashesEqual,
  hashToken,
  isWellFormedToken,
} from "../src/auth/shared/tokens.js";

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

describe("tokens", () => {
  it("generates 256-bit base64url tokens that differ every time", () => {
    const a = generateToken();
    expect(isWellFormedToken(a)).toBe(true);
    expect(a).not.toBe(generateToken());
  });

  it("hashes to 32 bytes and compares in constant time", () => {
    const token = generateToken();
    expect(hashToken(token)).toHaveLength(32);
    expect(hashesEqual(hashToken(token), hashToken(token))).toBe(true);
    expect(hashesEqual(hashToken(token), hashToken(generateToken()))).toBe(false);
    expect(hashesEqual(hashToken(token), Buffer.alloc(5))).toBe(false);
  });

  it("rejects values that are not tokens we issue", () => {
    for (const bad of ["", "short", `${"A".repeat(42)}=`, "A".repeat(44), `${"A".repeat(42)}!`]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});
