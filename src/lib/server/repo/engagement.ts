import type { SqlExecutor } from "../db/client";
import { toIso } from "../db/params";
import type { CommentDto } from "@/lib/domain/types";

/**
 * Likes, views, comments and reports. Counters on `videos` are updated in the same statement as
 * the row they count, so they cannot drift apart under concurrent requests.
 */

/** Records a like (or removes it). A device can like a video once: enforced by the primary key. */
export async function setVideoLike(
  db: SqlExecutor,
  videoId: string,
  deviceHash: string,
  like: boolean,
): Promise<{ liked: boolean; likeCount: number }> {
  if (like) {
    await db.query(
      `WITH ins AS (
         INSERT INTO video_likes (video_id, device_hash) VALUES ($1::uuid, $2) ON CONFLICT DO NOTHING RETURNING 1
       )
       UPDATE videos SET like_count = like_count + (SELECT count(*) FROM ins)
        WHERE id = $1::uuid AND status = 'approved'`,
      [videoId, deviceHash],
    );
  } else {
    await db.query(
      `WITH del AS (
         DELETE FROM video_likes WHERE video_id = $1::uuid AND device_hash = $2 RETURNING 1
       )
       UPDATE videos SET like_count = GREATEST(like_count - (SELECT count(*) FROM del), 0)
        WHERE id = $1::uuid`,
      [videoId, deviceHash],
    );
  }
  const rows = await db.query<{ like_count: number; liked: boolean }>(
    `SELECT v.like_count,
            EXISTS (SELECT 1 FROM video_likes l WHERE l.video_id = v.id AND l.device_hash = $2) AS liked
       FROM videos v WHERE v.id = $1::uuid`,
    [videoId, deviceHash],
  );
  return { liked: Boolean(rows[0]?.liked), likeCount: Number(rows[0]?.like_count ?? 0) };
}

/** Counts at most one view per device per video per UTC day. */
export async function recordVideoView(db: SqlExecutor, videoId: string, deviceHash: string, day: string): Promise<void> {
  await db.query(
    `WITH ins AS (
       INSERT INTO video_views (video_id, device_hash, view_date) VALUES ($1::uuid, $2, $3::date)
       ON CONFLICT DO NOTHING RETURNING 1
     )
     UPDATE videos SET view_count = view_count + (SELECT count(*) FROM ins)
      WHERE id = $1::uuid AND status = 'approved' AND (SELECT count(*) FROM ins) > 0`,
    [videoId, deviceHash, day],
  );
}

export interface CommentRecord {
  id: string;
  video_id: string;
  parent_id: string | null;
  author_name: string;
  body: string;
  status: "visible" | "pending" | "hidden" | "deleted";
  moderation_flags: string[];
  device_hash: string;
  delete_token_hash: string;
  created_at: Date | string;
}

export async function insertComment(
  db: SqlExecutor,
  args: {
    videoId: string;
    parentId: string | null;
    authorName: string;
    body: string;
    status: "visible" | "pending";
    flags: string[];
    deviceHash: string;
    deleteTokenHash: string;
  },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO comments (video_id, parent_id, author_name, body, status, moderation_flags, device_hash, delete_token_hash)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::text[], $7, $8)
     RETURNING id`,
    [
      args.videoId,
      args.parentId,
      args.authorName,
      args.body,
      args.status,
      args.flags,
      args.deviceHash,
      args.deleteTokenHash,
    ],
  );
  await recountComments(db, args.videoId);
  return rows[0]?.id ?? "";
}

export async function recountComments(db: SqlExecutor, videoId: string): Promise<void> {
  await db.query(
    `UPDATE videos SET comment_count = (
       SELECT count(*)::int FROM comments c WHERE c.video_id = $1::uuid AND c.status = 'visible'
     ) WHERE id = $1::uuid`,
    [videoId],
  );
}

export async function getComment(db: SqlExecutor, id: string): Promise<CommentRecord | null> {
  const rows = await db.query<CommentRecord>("SELECT * FROM comments WHERE id = $1::uuid", [id]);
  return rows[0] ?? null;
}

export async function setCommentStatus(
  db: SqlExecutor,
  id: string,
  status: CommentRecord["status"],
  actor: string | null,
  options: { redactBody?: boolean } = {},
): Promise<CommentRecord | null> {
  const rows = await db.query<CommentRecord>(
    `UPDATE comments
        SET status = $2,
            reviewed_by = coalesce($3, reviewed_by),
            body = CASE WHEN $4::boolean THEN '[محذوف]' ELSE body END,
            updated_at = now()
      WHERE id = $1::uuid
      RETURNING *`,
    [id, status, actor, options.redactBody ?? false],
  );
  const record = rows[0] ?? null;
  if (record) {
    // Replies to a hidden or deleted comment are hidden with it.
    if (status === "hidden" || status === "deleted") {
      await db.query(
        `UPDATE comments SET status = 'hidden', updated_at = now()
          WHERE parent_id = $1::uuid AND status IN ('visible', 'pending')`,
        [id],
      );
    }
    await recountComments(db, record.video_id);
  }
  return record;
}

export async function listPendingComments(
  db: SqlExecutor,
  status: "pending" | "hidden",
  offset: number,
  limit: number,
): Promise<Array<CommentRecord & { video_title: string; created_iso: string | null }>> {
  const rows = await db.query<CommentRecord & { video_title: string; created_at: Date | string }>(
    `SELECT c.*, v.title AS video_title
       FROM comments c JOIN videos v ON v.id = c.video_id
      WHERE c.status = $1
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, offset],
  );
  return rows.map((row) => ({ ...row, created_iso: toIso(row.created_at) }));
}

/** Visible comments for one video: newest top-level comments first, replies oldest first. */
export async function listVisibleComments(
  db: SqlExecutor,
  videoId: string,
  offset: number,
  limit: number,
): Promise<CommentDto[]> {
  const top = await db.query<{ id: string; parent_id: null; author_name: string; body: string; created_at: Date | string }>(
    `SELECT id, parent_id, author_name, body, created_at
       FROM comments
      WHERE video_id = $1::uuid AND status = 'visible' AND parent_id IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [videoId, limit, offset],
  );
  if (top.length === 0) return [];
  const replies = await db.query<{ id: string; parent_id: string; author_name: string; body: string; created_at: Date | string }>(
    `SELECT id, parent_id, author_name, body, created_at
       FROM comments
      WHERE parent_id = ANY($1::uuid[]) AND status = 'visible'
      ORDER BY created_at ASC`,
    [top.map((row) => row.id)],
  );
  const byParent = new Map<string, CommentDto[]>();
  for (const reply of replies) {
    const list = byParent.get(reply.parent_id) ?? [];
    list.push({
      id: reply.id,
      parentId: reply.parent_id,
      authorName: reply.author_name,
      body: reply.body,
      createdAt: toIso(reply.created_at) ?? "",
      replies: [],
    });
    byParent.set(reply.parent_id, list);
  }
  return top.map((row) => ({
    id: row.id,
    parentId: null,
    authorName: row.author_name,
    body: row.body,
    createdAt: toIso(row.created_at) ?? "",
    replies: byParent.get(row.id) ?? [],
  }));
}

export async function countRecentCommentsByDevice(db: SqlExecutor, deviceHash: string, since: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM comments WHERE device_hash = $1 AND created_at >= $2::timestamptz",
    [deviceHash, since.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function hasDuplicateComment(
  db: SqlExecutor,
  deviceHash: string,
  body: string,
  since: Date,
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM comments
      WHERE device_hash = $1 AND created_at >= $2::timestamptz AND lower(body) = lower($3)
      LIMIT 1`,
    [deviceHash, since.toISOString(), body],
  );
  return rows.length > 0;
}

export async function insertReport(
  db: SqlExecutor,
  args: {
    targetType: "video" | "comment";
    targetId: string;
    reason: string;
    details: string | null;
    reporterHash: string;
  },
): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO reports (target_type, target_id, reason, details, reporter_hash)
     VALUES ($1, $2::uuid, $3, $4, $5)
     ON CONFLICT (target_type, target_id, reporter_hash) DO NOTHING
     RETURNING id`,
    [args.targetType, args.targetId, args.reason, args.details, args.reporterHash],
  );
  return rows.length > 0;
}

export async function countOpenReports(db: SqlExecutor, targetType: "video" | "comment", targetId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM reports WHERE target_type = $1 AND target_id = $2::uuid AND status = 'open'",
    [targetType, targetId],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function syncVideoReportCount(db: SqlExecutor, videoId: string): Promise<void> {
  await db.query(
    `UPDATE videos SET report_count = (
       SELECT count(*)::int FROM reports r WHERE r.target_type = 'video' AND r.target_id = $1::uuid AND r.status = 'open'
     ) WHERE id = $1::uuid`,
    [videoId],
  );
}

export interface ReportRow {
  id: string;
  target_type: "video" | "comment";
  target_id: string;
  reason: string;
  details: string | null;
  status: "open" | "resolved" | "dismissed";
  resolution: string | null;
  created_at: Date | string;
  target_title: string | null;
  target_status: string | null;
  open_reports: number;
}

export async function listReports(
  db: SqlExecutor,
  status: "open" | "resolved" | "dismissed",
  offset: number,
  limit: number,
): Promise<ReportRow[]> {
  return db.query<ReportRow>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.resolution, r.created_at,
            CASE WHEN r.target_type = 'video' THEN v.title ELSE left(c.body, 140) END AS target_title,
            CASE WHEN r.target_type = 'video' THEN v.status ELSE c.status END AS target_status,
            (SELECT count(*)::int FROM reports r2
              WHERE r2.target_type = r.target_type AND r2.target_id = r.target_id AND r2.status = 'open') AS open_reports
       FROM reports r
       LEFT JOIN videos v ON r.target_type = 'video' AND v.id = r.target_id
       LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
    [status, limit, offset],
  );
}

export async function resolveReportsFor(
  db: SqlExecutor,
  targetType: "video" | "comment",
  targetId: string,
  status: "resolved" | "dismissed",
  resolution: string,
  actor: string,
): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `UPDATE reports SET status = $3, resolution = $4, resolved_at = now(), resolved_by = $5
      WHERE target_type = $1 AND target_id = $2::uuid AND status = 'open'
      RETURNING id`,
    [targetType, targetId, status, resolution, actor],
  );
  return rows.length;
}

export async function resolveReportById(
  db: SqlExecutor,
  id: string,
  status: "resolved" | "dismissed",
  resolution: string,
  actor: string,
): Promise<{ target_type: "video" | "comment"; target_id: string } | null> {
  const rows = await db.query<{ target_type: "video" | "comment"; target_id: string }>(
    `UPDATE reports SET status = $2, resolution = $3, resolved_at = now(), resolved_by = $4
      WHERE id = $1::uuid AND status = 'open'
      RETURNING target_type, target_id`,
    [id, status, resolution, actor],
  );
  return rows[0] ?? null;
}
