import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { getConfig } from "./config";

/**
 * Server-side cryptography helpers.
 *
 * Every stored identifier or token is an HMAC with a purpose label, so a value computed for one
 * purpose (for example a device) cannot be reused for another (for example an owner token).
 */

export function hmacHex(data: string, purpose: string): string {
  return createHmac("sha256", getConfig().secret).update(purpose).update("\u0000").update(data).digest("hex");
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** High-entropy URL-safe token (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no 0, 1, I, L, O or U (easy to read aloud)

/** Human-copyable recovery code, for example "K7Q2-9MTR-4XWA-HN3E" (80 bits of entropy). */
export function randomRecoveryCode(): string {
  let raw = "";
  for (let i = 0; i < 16; i += 1) {
    raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return raw.match(/.{4}/g)?.join("-") ?? raw;
}

/** Normalizes user-typed codes: removes spaces and dashes and upper-cases the letters. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function safeEqualString(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right) && a.length === b.length;
}

export function newId(): string {
  return randomUUID();
}

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Produces "scrypt$N$r$p$salt$hash". Used for admin passwords and for the admin_users table. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_KEYLEN, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ["scrypt", SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPasswordHash(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const expected = Buffer.from(parts[5] ?? "", "base64");
  if (expected.length === 0) return false;
  const actual = await scryptAsync(password, salt, expected.length, n, r, p);
  return timingSafeEqual(actual, expected);
}
