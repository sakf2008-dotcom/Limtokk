import type { SqlExecutor } from "./db/client";
import { getDb } from "./db/client";

/**
 * Runtime-adjustable platform settings, stored in the `settings` table.
 * Defaults here must match the seed values in db/schema.ts.
 */

export interface PlatformSettings {
  maxUploadBytes: number;
  maxDurationSeconds: number;
  minDurationSeconds: number;
  maxPendingPerDevice: number;
  maxSubmissionsPerDeviceDay: number;
  maxUploadsPerDayGlobal: number;
  maxStorageBytesTotal: number;
  pendingExpiryMinutes: number;
  rejectedRetentionDays: number;
  reportAutoHideThreshold: number;
  commentsEnabled: boolean;
  commentChallengeAfterRecent: number;
  extraBlockedTerms: string[];
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  maxUploadBytes: 52428800,
  maxDurationSeconds: 90,
  minDurationSeconds: 2,
  maxPendingPerDevice: 1,
  maxSubmissionsPerDeviceDay: 3,
  maxUploadsPerDayGlobal: 300,
  maxStorageBytesTotal: 1073741824,
  pendingExpiryMinutes: 30,
  rejectedRetentionDays: 30,
  reportAutoHideThreshold: 3,
  commentsEnabled: true,
  commentChallengeAfterRecent: 3,
  extraBlockedTerms: [],
};

const KEY_BY_FIELD: Record<keyof PlatformSettings, string> = {
  maxUploadBytes: "max_upload_bytes",
  maxDurationSeconds: "max_duration_seconds",
  minDurationSeconds: "min_duration_seconds",
  maxPendingPerDevice: "max_pending_per_device",
  maxSubmissionsPerDeviceDay: "max_submissions_per_device_per_day",
  maxUploadsPerDayGlobal: "max_uploads_per_day_global",
  maxStorageBytesTotal: "max_storage_bytes_total",
  pendingExpiryMinutes: "pending_expiry_minutes",
  rejectedRetentionDays: "rejected_retention_days",
  reportAutoHideThreshold: "report_auto_hide_threshold",
  commentsEnabled: "comments_enabled",
  commentChallengeAfterRecent: "comment_challenge_after_recent",
  extraBlockedTerms: "extra_blocked_terms",
};

export const SETTING_LIMITS: Partial<Record<keyof PlatformSettings, { min: number; max: number }>> = {
  maxUploadBytes: { min: 1_048_576, max: 524_288_000 },
  maxDurationSeconds: { min: 10, max: 600 },
  minDurationSeconds: { min: 1, max: 30 },
  maxPendingPerDevice: { min: 1, max: 5 },
  maxSubmissionsPerDeviceDay: { min: 1, max: 50 },
  maxUploadsPerDayGlobal: { min: 1, max: 100_000 },
  maxStorageBytesTotal: { min: 104_857_600, max: 10_995_116_277_760 },
  pendingExpiryMinutes: { min: 5, max: 1440 },
  rejectedRetentionDays: { min: 1, max: 365 },
  reportAutoHideThreshold: { min: 1, max: 100 },
  commentChallengeAfterRecent: { min: 1, max: 100 },
};

function coerce<K extends keyof PlatformSettings>(field: K, raw: unknown): PlatformSettings[K] {
  const fallback = DEFAULT_SETTINGS[field];
  if (typeof fallback === "boolean") {
    return (typeof raw === "boolean" ? raw : fallback) as PlatformSettings[K];
  }
  if (Array.isArray(fallback)) {
    return (Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string").slice(0, 100) : fallback) as PlatformSettings[K];
  }
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return (Number.isFinite(numeric) ? numeric : fallback) as PlatformSettings[K];
}

export async function getSettings(executor?: SqlExecutor): Promise<PlatformSettings> {
  const db = executor ?? (await getDb());
  const rows = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM settings");
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const result = { ...DEFAULT_SETTINGS, extraBlockedTerms: [...DEFAULT_SETTINGS.extraBlockedTerms] };
  for (const field of Object.keys(KEY_BY_FIELD) as Array<keyof PlatformSettings>) {
    const dbKey = KEY_BY_FIELD[field];
    if (byKey.has(dbKey)) {
      (result as Record<string, unknown>)[field] = coerce(field, byKey.get(dbKey));
    }
  }
  return result;
}

/** Writes only the provided fields. Values must already be validated by the caller. */
export async function saveSettings(
  executor: SqlExecutor,
  patch: Partial<PlatformSettings>,
  actor: string,
): Promise<void> {
  for (const field of Object.keys(patch) as Array<keyof PlatformSettings>) {
    const value = patch[field];
    if (value === undefined) continue;
    await executor.query(
      `INSERT INTO settings (key, value, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [KEY_BY_FIELD[field], JSON.stringify(value), actor],
    );
  }
}
