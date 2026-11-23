import type { SqlExecutor } from "../db/client";
import { toIso } from "../db/params";

/** Audit log, device blocks, aggregate statistics and retention housekeeping. */

export async function appendAudit(
  db: SqlExecutor,
  args: { actor: string; action: string; targetType: string; targetId: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await db.query(
    `INSERT INTO admin_audit_logs (actor, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [args.actor, args.action, args.targetType, args.targetId, JSON.stringify(args.details ?? {})],
  );
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export async function listAudit(db: SqlExecutor, offset: number, limit: number): Promise<AuditRow[]> {
  const rows = await db.query<AuditRow & { created_at: Date | string }>(
    `SELECT id, actor, action, target_type, target_id, details, created_at
       FROM admin_audit_logs
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map((row) => ({ ...row, created_at: toIso(row.created_at) ?? "" }));
}

export async function blockDevice(db: SqlExecutor, deviceHash: string, reason: string, expiresAt: Date | null): Promise<void> {
  await db.query(
    `INSERT INTO blocked_devices (device_hash, reason, expires_at) VALUES ($1, $2, $3::timestamptz)
     ON CONFLICT (device_hash) DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [deviceHash, reason, expiresAt ? expiresAt.toISOString() : null],
  );
}

export async function unblockDevice(db: SqlExecutor, deviceHash: string): Promise<void> {
  await db.query("DELETE FROM blocked_devices WHERE device_hash = $1", [deviceHash]);
}

export async function isDeviceBlocked(db: SqlExecutor, deviceHash: string, now: Date): Promise<boolean> {
  const rows = await db.query<{ device_hash: string }>(
    `SELECT device_hash FROM blocked_devices
      WHERE device_hash = $1 AND (expires_at IS NULL OR expires_at > $2::timestamptz)`,
    [deviceHash, now.toISOString()],
  );
  return rows.length > 0;
}

export type DailyStatField = "uploads" | "approvals" | "rejections" | "reports" | "comments" | "likes";

const DAILY_FIELDS: Record<DailyStatField, true> = {
  uploads: true,
  approvals: true,
  rejections: true,
  reports: true,
  comments: true,
  likes: true,
};

/** Adds to one counter of today's aggregate row. The field name comes from a fixed allowlist. */
export async function bumpDailyStat(
  db: SqlExecutor,
  field: DailyStatField,
  amount: number,
  now: Date,
  bytes = 0,
): Promise<void> {
  if (!DAILY_FIELDS[field]) throw new Error(`Unknown daily stat field: ${field}`);
  const day = now.toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO daily_stats (day, ${field}, bytes_uploaded)
     VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET
       ${field} = daily_stats.${field} + EXCLUDED.${field},
       bytes_uploaded = daily_stats.bytes_uploaded + EXCLUDED.bytes_uploaded`,
    [day, amount, bytes],
  );
}

export interface DailyStatRow {
  day: string;
  uploads: number;
  approvals: number;
  rejections: number;
  reports: number;
  comments: number;
  likes: number;
  bytes_uploaded: number | string;
}

export async function recentDailyStats(db: SqlExecutor, days: number, now: Date): Promise<DailyStatRow[]> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.query<DailyStatRow>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, uploads, approvals, rejections, reports, comments, likes, bytes_uploaded
       FROM daily_stats WHERE day >= $1::date ORDER BY day DESC`,
    [cutoff],
  );
  return rows.map((row) => ({ ...row, bytes_uploaded: Number(row.bytes_uploaded) }));
}

export async function countOpenReportsTotal(db: SqlExecutor): Promise<number> {
  const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM reports WHERE status = 'open'");
  return Number(rows[0]?.n ?? 0);
}

export async function countHeldComments(db: SqlExecutor): Promise<number> {
  const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM comments WHERE status = 'pending'");
  return Number(rows[0]?.n ?? 0);
}

export async function totalsForDashboard(db: SqlExecutor): Promise<{
  approvedVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  creators: number;
  blockedDevices: number;
}> {
  const rows = await db.query<Record<string, number | string>>(
    `SELECT
       (SELECT count(*) FROM videos WHERE status = 'approved' AND NOT is_demo)::int AS approved_videos,
       (SELECT coalesce(sum(view_count), 0) FROM videos WHERE status = 'approved' AND NOT is_demo)::bigint AS total_views,
       (SELECT coalesce(sum(like_count), 0) FROM videos WHERE status = 'approved' AND NOT is_demo)::bigint AS total_likes,
       (SELECT count(*) FROM comments WHERE status = 'visible')::int AS total_comments,
       (SELECT count(*) FROM creators)::int AS creators,
       (SELECT count(*) FROM blocked_devices)::int AS blocked_devices`,
  );
  const row = rows[0] ?? {};
  return {
    approvedVideos: Number(row.approved_videos ?? 0),
    totalViews: Number(row.total_views ?? 0),
    totalLikes: Number(row.total_likes ?? 0),
    totalComments: Number(row.total_comments ?? 0),
    creators: Number(row.creators ?? 0),
    blockedDevices: Number(row.blocked_devices ?? 0),
  };
}

export async function purgeOldViews(db: SqlExecutor, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.query<{ video_id: string }>(
    "DELETE FROM video_views WHERE view_date < $1::date RETURNING video_id",
    [cutoff],
  );
  return rows.length;
}

export async function purgeOldAudit(db: SqlExecutor, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db.query<{ id: number }>(
    "DELETE FROM admin_audit_logs WHERE created_at < $1::timestamptz RETURNING id",
    [cutoff],
  );
  return rows.length;
}

export async function purgeExpiredBlocks(db: SqlExecutor, now: Date): Promise<number> {
  const rows = await db.query<{ device_hash: string }>(
    "DELETE FROM blocked_devices WHERE expires_at IS NOT NULL AND expires_at < $1::timestamptz RETURNING device_hash",
    [now.toISOString()],
  );
  return rows.length;
}
