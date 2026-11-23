import { getDb } from "../db/client";
import { getSettings } from "../settings";
import { BUCKET_PENDING, BUCKET_PUBLIC, getBlobStore, isStorageAvailable, type BucketName } from "../storage";
import { expiredPendingUploads, purgeOldClosedVideos } from "../repo/videos";
import { purgeExpiredBlocks, purgeOldAudit, purgeOldViews } from "../repo/ops";
import { purgeOldRateLimits } from "../rate-limit";
import { purgeExpiredChallenges } from "../pow";

/**
 * Retention and storage cleanup. Runs on a schedule (see vercel.json) and can be triggered by the
 * admin. It is idempotent: running it twice is harmless.
 *
 * Retention rules (also described in the public privacy page):
 *  - Unfinished uploads expire after `pendingExpiryMinutes` and their files are deleted.
 *  - Rejected or expired records and their files are deleted after `rejectedRetentionDays`.
 *  - Rate-limit counters: 2 days. Challenge records: until they expire. Daily view marks: 3 days.
 *  - Audit log: 365 days. Temporary device blocks: until they expire.
 */

export interface CleanupSummary {
  expiredUploads: number;
  purgedVideos: number;
  storageObjectsRemoved: number;
  storageErrors: number;
  rateLimitRows: number;
  challengeRows: number;
  viewRows: number;
  auditRows: number;
  expiredBlocks: number;
}

async function removeObjects(items: Array<{ bucket: string; key: string | null }>): Promise<{ removed: number; errors: number }> {
  if (!isStorageAvailable()) return { removed: 0, errors: 0 };
  const store = getBlobStore();
  let removed = 0;
  let errors = 0;
  for (const item of items) {
    if (!item.key) continue;
    const bucket: BucketName | null = item.bucket === "pending" ? BUCKET_PENDING : item.bucket === "public" ? BUCKET_PUBLIC : null;
    if (!bucket) continue;
    try {
      await store.remove(bucket, [item.key]);
      removed += 1;
    } catch (error) {
      errors += 1;
      console.error("[cleanup] storage delete failed:", error);
    }
  }
  return { removed, errors };
}

export async function runCleanup(now: Date = new Date()): Promise<CleanupSummary> {
  const db = await getDb();
  const settings = await getSettings(db);

  const expired = await expiredPendingUploads(db, now);
  const expiredFiles = await removeObjects(expired.map((row) => ({ bucket: "pending", key: row.storage_key })));

  const retentionCutoff = new Date(now.getTime() - settings.rejectedRetentionDays * 86_400_000);
  const purged = await purgeOldClosedVideos(db, retentionCutoff);
  const purgedFiles = await removeObjects(purged.map((row) => ({ bucket: row.storage_bucket, key: row.storage_key })));

  const rateLimitRows = await purgeOldRateLimits(db, now);
  const challengeRows = await purgeExpiredChallenges(db, now);
  const viewRows = await purgeOldViews(db, now);
  const auditRows = await purgeOldAudit(db, now);
  const expiredBlocks = await purgeExpiredBlocks(db, now);

  return {
    expiredUploads: expired.length,
    purgedVideos: purged.length,
    storageObjectsRemoved: expiredFiles.removed + purgedFiles.removed,
    storageErrors: expiredFiles.errors + purgedFiles.errors,
    rateLimitRows,
    challengeRows,
    viewRows,
    auditRows,
    expiredBlocks,
  };
}
