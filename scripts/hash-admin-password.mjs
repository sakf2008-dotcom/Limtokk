// Prints an scrypt hash for ADMIN_PASSWORD_HASH. The password is read from the environment
// variable ADMIN_PLAIN_PASSWORD (never from a file in the repository).
// Usage: ADMIN_PLAIN_PASSWORD='...' node scripts/hash-admin-password.mjs
import { randomBytes, scrypt as scryptCallback } from "node:crypto";

const password = process.env.ADMIN_PLAIN_PASSWORD ?? "";
if (password.length < 12) {
  console.error("Set ADMIN_PLAIN_PASSWORD to a password of at least 12 characters.");
  process.exit(1);
}
const N = 32768;
const r = 8;
const p = 1;
const salt = randomBytes(16);
const key = await new Promise((resolve, reject) =>
  scryptCallback(password, salt, 32, { N, r, p, maxmem: 128 * 1024 * 1024 }, (error, derived) =>
    error ? reject(error) : resolve(derived),
  ),
);
console.log(["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$"));
