import type { SqlExecutor } from "./db/client";
import { ApiError } from "./http";

/**
 * Fixed-window rate limiter stored in PostgreSQL.
 *
 * The counter is incremented with a single atomic upsert, so it stays correct across several
 * serverless instances (an in-memory limiter would not). Keys hold only HMACs, never raw
 * identifiers.
 */

export interface RateResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export async function consumeRate(
  executor: SqlExecutor,
  key: string,
  limit: number,
  windowSeconds: number,
  now: Date = new Date(),
): Promise<RateResult> {
  const nowIso = now.toISOString();
  const windowStartCutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString();
  const rows = await executor.query<{ count: number; window_start: Date | string }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, $2::timestamptz, 1)
     ON CONFLICT (key) DO UPDATE SET
       window_start = CASE WHEN rate_limits.window_start <= $3::timestamptz THEN $2::timestamptz ELSE rate_limits.window_start END,
       count = CASE WHEN rate_limits.window_start <= $3::timestamptz THEN 1 ELSE rate_limits.count + 1 END
     RETURNING count, window_start`,
    [key, nowIso, windowStartCutoff],
  );
  const row = rows[0];
  const count = Number(row?.count ?? 1);
  const windowStart = new Date(row?.window_start ?? nowIso).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowSeconds * 1000 - now.getTime()) / 1000));
  return { allowed: count <= limit, count, retryAfterSeconds };
}

/** Throws a 429 ApiError when the limit is exceeded. */
export async function enforceRate(
  executor: SqlExecutor,
  key: string,
  limit: number,
  windowSeconds: number,
  message = "عدد المحاولات كبير في وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.",
  now: Date = new Date(),
): Promise<void> {
  const result = await consumeRate(executor, key, limit, windowSeconds, now);
  if (!result.allowed) {
    throw new ApiError(429, "rate_limited", message, { retryAfterSeconds: result.retryAfterSeconds });
  }
}

export async function purgeOldRateLimits(executor: SqlExecutor, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await executor.query<{ key: string }>(
    "DELETE FROM rate_limits WHERE window_start < $1::timestamptz RETURNING key",
    [cutoff],
  );
  return rows.length;
}
