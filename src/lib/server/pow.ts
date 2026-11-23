import { createHash, randomBytes } from "node:crypto";
import { getDb, type SqlExecutor } from "./db/client";
import { ApiError } from "./http";
import { hmacHex, safeEqualHex } from "./crypto";

/**
 * Anti-bot proof of work.
 *
 * The server issues a signed challenge. The browser must find a nonce such that
 * SHA-256("<prefix>:<nonce>") starts with `difficultyBits` zero bits. Solving costs a human a
 * second or two on a phone, but makes automated mass submission expensive. Each challenge can be
 * used once (recorded in used_challenges). This is a cost barrier, not a CAPTCHA, and it does not
 * prove that the requester is human.
 */

export const POW_DIFFICULTY_BITS = 16;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_NONCE_LENGTH = 20;

export interface PowChallenge {
  token: string;
  prefix: string;
  difficultyBits: number;
  expiresAt: string;
}

export function issuePowChallenge(now: Date = new Date()): PowChallenge {
  const id = randomBytes(12).toString("base64url");
  const prefix = randomBytes(16).toString("base64url");
  const expires = now.getTime() + CHALLENGE_TTL_MS;
  const payload = [id, prefix, String(POW_DIFFICULTY_BITS), String(expires)].join(".");
  const signature = hmacHex(payload, "pow");
  return {
    token: `${Buffer.from(payload).toString("base64url")}.${signature}`,
    prefix,
    difficultyBits: POW_DIFFICULTY_BITS,
    expiresAt: new Date(expires).toISOString(),
  };
}

export function leadingZeroBits(buffer: Buffer): number {
  let bits = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

export function powDigest(prefix: string, nonce: string): Buffer {
  return createHash("sha256").update(`${prefix}:${nonce}`).digest();
}

interface ParsedChallenge {
  id: string;
  prefix: string;
  bits: number;
  expires: number;
}

function parseChallenge(token: string): ParsedChallenge | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!safeEqualHex(signature, hmacHex(payload, "pow"))) return null;
  const [id, prefix, bitsRaw, expiresRaw] = payload.split(".");
  const bits = Number(bitsRaw);
  const expires = Number(expiresRaw);
  if (!id || !prefix || !Number.isInteger(bits) || !Number.isFinite(expires)) return null;
  return { id, prefix, bits, expires };
}

/**
 * Verifies a solved challenge and marks it as used. Throws ApiError on any failure.
 * Pass `db` when already inside a request that holds a connection.
 */
export async function verifyAndConsumePow(
  input: { token: unknown; nonce: unknown },
  now: Date = new Date(),
  db?: SqlExecutor,
): Promise<void> {
  const token = typeof input.token === "string" ? input.token : "";
  const nonce = typeof input.nonce === "string" ? input.nonce : "";
  const parsed = parseChallenge(token);
  if (!parsed || !/^[0-9]{1,20}$/.test(nonce) || nonce.length > MAX_NONCE_LENGTH) {
    throw new ApiError(400, "challenge_invalid", "تعذّر التحقق من إثبات الإنسان. أعد المحاولة.");
  }
  if (parsed.expires < now.getTime()) {
    throw new ApiError(400, "challenge_expired", "انتهت صلاحية التحقق. أعد المحاولة.");
  }
  if (leadingZeroBits(powDigest(parsed.prefix, nonce)) < parsed.bits) {
    throw new ApiError(400, "challenge_invalid", "تعذّر التحقق من إثبات الإنسان. أعد المحاولة.");
  }

  const executor = db ?? (await getDb());
  const inserted = await executor.query<{ challenge_id: string }>(
    `INSERT INTO used_challenges (challenge_id, expires_at)
     VALUES ($1, $2::timestamptz)
     ON CONFLICT (challenge_id) DO NOTHING
     RETURNING challenge_id`,
    [parsed.id, new Date(parsed.expires).toISOString()],
  );
  if (inserted.length === 0) {
    throw new ApiError(409, "challenge_reused", "هذا التحقق استُخدم مسبقًا. أعد المحاولة.");
  }
}

/** Removes expired challenge records. Called from the cleanup job. */
export async function purgeExpiredChallenges(executor: SqlExecutor, now: Date): Promise<number> {
  const rows = await executor.query<{ challenge_id: string }>(
    "DELETE FROM used_challenges WHERE expires_at < $1::timestamptz RETURNING challenge_id",
    [now.toISOString()],
  );
  return rows.length;
}
