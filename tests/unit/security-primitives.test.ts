import { describe, expect, it } from "vitest";
import { hashPassword, verifyPasswordHash, randomRecoveryCode, normalizeRecoveryCode, hmacHex, safeEqualHex } from "@/lib/server/crypto";
import { issueAdminSession, verifyAdminSession } from "@/lib/server/auth/admin";
import { checkPasswordAgainst } from "@/lib/server/auth/password";

describe("password hashing (scrypt)", () => {
  it("verifies the right password and rejects others", async () => {
    const encoded = await hashPassword("correct horse battery staple");
    expect(encoded.startsWith("scrypt$")).toBe(true);
    expect(await verifyPasswordHash("correct horse battery staple", encoded)).toBe(true);
    expect(await verifyPasswordHash("correct horse battery stapleX", encoded)).toBe(false);
  });

  it("rejects malformed stored hashes instead of throwing", async () => {
    expect(await verifyPasswordHash("x", "not-a-hash")).toBe(false);
    expect(await verifyPasswordHash("x", "scrypt$abc$8$1$AAAA$AAAA")).toBe(false);
  });

  it("compares plain admin passwords in constant time without length leaks", async () => {
    expect(await checkPasswordAgainst("secret-value-123", null, "secret-value-123")).toBe(true);
    expect(await checkPasswordAgainst("secret-value-12", null, "secret-value-123")).toBe(false);
    expect(await checkPasswordAgainst("", null, "secret-value-123")).toBe(false);
  });
});

describe("recovery codes", () => {
  it("generates readable, grouped codes without ambiguous characters", () => {
    for (let i = 0; i < 25; i += 1) {
      const code = randomRecoveryCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}(-[ABCDEFGHJKMNPQRSTVWXYZ23456789]{4}){3}$/);
      expect(code).not.toMatch(/[01ILOU]/);
    }
  });

  it("normalizes typed codes so spacing and case do not matter", () => {
    expect(normalizeRecoveryCode(" k7q2-9mtr 4xwa-hn3e ")).toBe("K7Q29MTR4XWAHN3E");
  });
});

describe("keyed hashing and constant-time comparison", () => {
  it("separates purposes so one token cannot be replayed as another", () => {
    expect(hmacHex("same", "owner")).not.toBe(hmacHex("same", "device"));
    expect(hmacHex("same", "owner")).toBe(hmacHex("same", "owner"));
  });

  it("compares hex digests of equal length only", () => {
    const a = hmacHex("a", "owner");
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, hmacHex("b", "owner"))).toBe(false);
    expect(safeEqualHex(a, a.slice(0, 10))).toBe(false);
    expect(safeEqualHex("", "")).toBe(false);
  });
});

describe("admin session tokens", () => {
  it("verifies a fresh session and expires it after eight hours", () => {
    const issued = issueAdminSession(new Date("2030-05-01T10:00:00Z"));
    expect(verifyAdminSession(issued.token, new Date("2030-05-01T10:30:00Z"))).toBe(true);
    expect(verifyAdminSession(issued.token, new Date("2030-05-01T19:00:00Z"))).toBe(false);
  });

  it("refuses malformed tokens", () => {
    expect(verifyAdminSession("", new Date())).toBe(false);
    expect(verifyAdminSession("1.2.3", new Date())).toBe(false);
  });
});
