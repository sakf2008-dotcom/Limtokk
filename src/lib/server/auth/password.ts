import { safeEqualString, verifyPasswordHash } from "../crypto";

/**
 * Checks a typed password against either a scrypt hash (preferred) or a plain secret from the
 * environment. Plain comparison uses SHA-256 digests in constant time, so length does not leak.
 */
export async function checkPasswordAgainst(
  input: string,
  hash: string | null,
  plain: string | null,
): Promise<boolean> {
  if (input.length === 0 || input.length > 512) return false;
  if (hash) return verifyPasswordHash(input, hash);
  if (plain) return safeEqualString(input, plain);
  return false;
}
