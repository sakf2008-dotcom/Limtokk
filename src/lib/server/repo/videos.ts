import type { SqlExecutor } from "../db/client";
import { ParamList, toIso } from "../db/params";
import { escapeLike } from "@/lib/domain/text";
import type { VideoCardDto, VideoStatus } from "@/lib/domain/types";
import { publicMediaUrl, type MediaBucketTag } from "../media-url";

/**
 * Video reads and writes. Public queries always filter on status = 'approved'. Owner and admin
 * queries are separate functions, so a public query can never accidentally expose internal fields.
 */

export interface VideoCardRow {
  id: string;
  title: string;
  description: string;
  key_fact: string | null;
  hashtags: string[] | null;
  category_id: string;
  category_name: string;
  category_accent: string;
  creator_id: string;
  creator_name: string;
  creator_avatar: string;
  storage_bucket: MediaBucketTag;
  storage_key: string | null;
  poster_key: string | null;
  is_demo: boolean;
  duration_ms: number | string;
  width: number | null;
  height: number | null;
  like_count: number;
  view_count: number;
  comment_count: number;
  quiz_count: number;
  is_featured: boolean;
  published_at: Date | string | null;
  liked: boolean;
}

const CARD_SELECT = `
  v.id, v.title, v.description, v.key_fact, v.hashtags, v.category_id,
  c.name_ar AS category_name, c.accent AS category_accent,
  v.creator_id, cr.display_name AS creator_name, cr.avatar_key AS creator_avatar,
  v.storage_bucket, v.storage_key, v.poster_key, v.is_demo,
  v.duration_ms, v.width, v.height,
  v.like_count, v.view_count, v.comment_count, v.is_featured, v.published_at,
  (SELECT count(*)::int FROM quizzes q WHERE q.video_id = v.id AND q.is_active) AS quiz_count`;

const CARD_FROM = `
  FROM videos v
  JOIN categories c ON c.id = v.category_id
  JOIN creators cr ON cr.id = v.creator_id`;

export function toVideoCard(row: VideoCardRow): VideoCardDto {
  const mediaUrl = publicMediaUrl(row.storage_bucket, row.storage_key) ?? "";
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    keyFact: row.key_fact,
    hashtags: row.hashtags ?? [],
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryAccent: row.category_accent,
    creator: { id: row.creator_id, name: row.creator_name, avatar: row.creator_avatar },
    mediaUrl,
    posterUrl: row.is_demo ? publicMediaUrl("demo", row.poster_key) : null,
    durationMs: Number(row.duration_ms),
    width: row.width,
    height: row.height,
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
    viewCount: Number(row.view_count),
    quizCount: Number(row.quiz_count),
    liked: Boolean(row.liked),
    isDemo: Boolean(row.is_demo),
    isFeatured: Boolean(row.is_featured),
    publishedAt: toIso(row.published_at),
  };
}

function likedColumn(params: ParamList, deviceHash: string | null): string {
  const device = params.ref(deviceHash, "text");
  return `EXISTS (SELECT 1 FROM video_likes l WHERE l.video_id = v.id AND l.device_hash = ${device}) AS liked`;
}

export interface FeedArgs {
  tab: "foryou" | "latest";
  categoryId: string | null;
  preferCategories: string[];
  offset: number;
  limit: number;
  deviceHash: string | null;
  now: Date;
}

/**
 * "لك" ranks by a simple, transparent score: engagement divided by age (a gravity-style decay),
 * with a boost for categories the device has chosen. It is not a trained recommendation model.
 * "الأحدث" is pure recency.
 */
export async function fetchFeed(db: SqlExecutor, args: FeedArgs): Promise<VideoCardDto[]> {
  const p = new ParamList();
  const liked = likedColumn(p, args.deviceHash);
  const category = p.ref(args.categoryId, "text");
  let order = "v.published_at DESC, v.id DESC";
  if (args.tab === "foryou") {
    const prefs = p.ref(args.preferCategories, "text[]");
    const now = p.ref(args.now.toISOString(), "timestamptz");
    order = `(CASE WHEN v.category_id = ANY(${prefs}) THEN 1 ELSE 0 END) DESC,
      ((v.like_count * 3 + v.comment_count * 2 + v.view_count * 0.2 + CASE WHEN v.is_featured THEN 5 ELSE 0 END + 1)
        / power(greatest(extract(epoch FROM (${now} - v.published_at)) / 3600.0, 0) + 2, 1.5)) DESC,
      v.published_at DESC, v.id DESC`;
  }
  const limit = p.ref(args.limit, "int");
  const offset = p.ref(args.offset, "int");
  const rows = await db.query<VideoCardRow>(
    `SELECT ${CARD_SELECT}, ${liked}
     ${CARD_FROM}
     WHERE v.status = 'approved' AND (${category} IS NULL OR v.category_id = ${category})
     ORDER BY ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
  return rows.map(toVideoCard);
}

export interface SearchArgs {
  text: string | null;
  categoryId: string | null;
  tag: string | null;
  creatorId: string | null;
  offset: number;
  limit: number;
  deviceHash: string | null;
}

export async function searchVideos(db: SqlExecutor, args: SearchArgs): Promise<VideoCardDto[]> {
  const p = new ParamList();
  const liked = likedColumn(p, args.deviceHash);
  const text = args.text ? p.ref(`%${escapeLike(args.text)}%`, "text") : p.ref(null, "text");
  const category = p.ref(args.categoryId, "text");
  const tag = p.ref(args.tag, "text");
  const creator = p.ref(args.creatorId, "uuid");
  const limit = p.ref(args.limit, "int");
  const offset = p.ref(args.offset, "int");
  const rows = await db.query<VideoCardRow>(
    `SELECT ${CARD_SELECT}, ${liked}
     ${CARD_FROM}
     WHERE v.status = 'approved'
       AND (${text} IS NULL OR v.search_text LIKE ${text} ESCAPE '\\')
       AND (${category} IS NULL OR v.category_id = ${category})
       AND (${tag} IS NULL OR ${tag} = ANY(v.hashtags))
       AND (${creator} IS NULL OR v.creator_id = ${creator})
     ORDER BY v.published_at DESC, v.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
  return rows.map(toVideoCard);
}

export async function getPublicVideo(
  db: SqlExecutor,
  id: string,
  deviceHash: string | null,
): Promise<VideoCardDto | null> {
  const p = new ParamList();
  const liked = likedColumn(p, deviceHash);
  const videoId = p.ref(id, "uuid");
  const rows = await db.query<VideoCardRow>(
    `SELECT ${CARD_SELECT}, ${liked}
     ${CARD_FROM}
     WHERE v.id = ${videoId} AND v.status = 'approved'`,
    p.values,
  );
  return rows[0] ? toVideoCard(rows[0]) : null;
}

/** Returns approved videos in the order of `ids`. Unknown or unapproved ids are skipped. */
export async function getPublicVideosByIds(
  db: SqlExecutor,
  ids: string[],
  deviceHash: string | null,
): Promise<VideoCardDto[]> {
  if (ids.length === 0) return [];
  const p = new ParamList();
  const liked = likedColumn(p, deviceHash);
  const list = p.ref(ids, "uuid[]");
  const rows = await db.query<VideoCardRow>(
    `SELECT ${CARD_SELECT}, ${liked}
     ${CARD_FROM}
     WHERE v.id = ANY(${list}) AND v.status = 'approved'`,
    p.values,
  );
  const byId = new Map(rows.map((row) => [row.id, toVideoCard(row)]));
  return ids.map((id) => byId.get(id)).filter((card): card is VideoCardDto => Boolean(card));
}

export async function getFeaturedVideos(db: SqlExecutor, limit: number, deviceHash: string | null): Promise<VideoCardDto[]> {
  const p = new ParamList();
  const liked = likedColumn(p, deviceHash);
  const max = p.ref(limit, "int");
  const rows = await db.query<VideoCardRow>(
    `SELECT ${CARD_SELECT}, ${liked}
     ${CARD_FROM}
     WHERE v.status = 'approved' AND v.is_featured
     ORDER BY COALESCE(v.featured_rank, 999999), v.published_at DESC
     LIMIT ${max}`,
    p.values,
  );
  return rows.map(toVideoCard);
}

export async function trendingTags(db: SqlExecutor, limit: number): Promise<Array<{ tag: string; uses: number }>> {
  const rows = await db.query<{ tag: string; uses: number }>(
    `SELECT tag, count(*)::int AS uses
       FROM videos v, unnest(v.hashtags) AS tag
      WHERE v.status = 'approved'
      GROUP BY tag
      ORDER BY uses DESC, tag
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({ tag: row.tag, uses: Number(row.uses) }));
}

export interface CreatorProfileRow {
  id: string;
  display_name: string;
  avatar_key: string;
  video_count: number;
  total_views: number | string;
  total_likes: number | string;
}

export async function getCreatorProfile(db: SqlExecutor, id: string): Promise<CreatorProfileRow | null> {
  const rows = await db.query<CreatorProfileRow>(
    `SELECT cr.id, cr.display_name, cr.avatar_key,
            count(v.id) FILTER (WHERE v.status = 'approved')::int AS video_count,
            coalesce(sum(v.view_count) FILTER (WHERE v.status = 'approved'), 0)::bigint AS total_views,
            coalesce(sum(v.like_count) FILTER (WHERE v.status = 'approved'), 0)::bigint AS total_likes
       FROM creators cr
       LEFT JOIN videos v ON v.creator_id = cr.id
      WHERE cr.id = $1
      GROUP BY cr.id`,
    [id],
  );
  const row = rows[0];
  // Creators without approved videos have no public presence, so their page does not exist publicly.
  if (!row || Number(row.video_count) === 0) return null;
  return row;
}

export async function searchCreators(
  db: SqlExecutor,
  text: string,
  limit: number,
): Promise<Array<{ id: string; name: string; avatar: string; videoCount: number }>> {
  const rows = await db.query<{ id: string; display_name: string; avatar_key: string; video_count: number }>(
    `SELECT cr.id, cr.display_name, cr.avatar_key, count(v.id)::int AS video_count
       FROM creators cr
       JOIN videos v ON v.creator_id = cr.id AND v.status = 'approved'
      WHERE lower(cr.display_name) LIKE $1 ESCAPE '\\'
      GROUP BY cr.id
      ORDER BY video_count DESC, cr.display_name
      LIMIT $2`,
    [`%${escapeLike(text.toLowerCase())}%`, limit],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.display_name,
    avatar: row.avatar_key,
    videoCount: Number(row.video_count),
  }));
}

/** Creator-only lookup used when uploading: finds a creator that belongs to this device. */
export async function findOwnCreator(
  db: SqlExecutor,
  creatorId: string,
  deviceHash: string,
): Promise<{ id: string; display_name: string; avatar_key: string } | null> {
  const rows = await db.query<{ id: string; display_name: string; avatar_key: string }>(
    "SELECT id, display_name, avatar_key FROM creators WHERE id = $1 AND device_hash = $2",
    [creatorId, deviceHash],
  );
  return rows[0] ?? null;
}

export async function insertCreator(
  db: SqlExecutor,
  args: { displayName: string; avatarKey: string; deviceHash: string | null },
): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO creators (display_name, avatar_key, device_hash) VALUES ($1, $2, $3) RETURNING id`,
    [args.displayName, args.avatarKey, args.deviceHash],
  );
  return rows[0]?.id ?? "";
}

export async function updateCreatorIdentity(
  db: SqlExecutor,
  creatorId: string,
  displayName: string,
  avatarKey: string,
): Promise<void> {
  await db.query(
    "UPDATE creators SET display_name = $2, avatar_key = $3, updated_at = now() WHERE id = $1",
    [creatorId, displayName, avatarKey],
  );
}

/** Full internal record, used only by server-side logic (ownership checks, storage, moderation). */
export interface VideoRecord {
  id: string;
  creator_id: string;
  category_id: string;
  title: string;
  description: string;
  key_fact: string | null;
  hashtags: string[];
  search_text: string;
  status: VideoStatus;
  is_demo: boolean;
  storage_bucket: "pending" | "public" | "demo";
  storage_key: string | null;
  mime_type: string | null;
  size_bytes: number | string | null;
  duration_ms: number | string | null;
  owner_token_hash: string;
  recovery_hash: string | null;
  submitter_hash: string | null;
  moderation_flags: string[];
  rejection_reason: string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  published_at: Date | string | null;
  like_count: number;
  report_count: number;
  is_featured: boolean;
}

export async function getVideoRecord(db: SqlExecutor, id: string): Promise<VideoRecord | null> {
  const rows = await db.query<VideoRecord>("SELECT * FROM videos WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function insertVideo(
  db: SqlExecutor,
  args: {
    id: string;
    creatorId: string;
    categoryId: string;
    title: string;
    description: string;
    keyFact: string | null;
    hashtags: string[];
    searchText: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    ownerTokenHash: string;
    submitterHash: string;
    expiresAt: Date;
    now: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO videos (
       id, creator_id, category_id, title, description, key_fact, hashtags, search_text,
       status, storage_bucket, storage_key, mime_type, size_bytes,
       owner_token_hash, submitter_hash, expires_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7::text[], $8,
       'pending_upload', 'pending', $9, $10, $11,
       $12, $13, $14::timestamptz, $15::timestamptz, $15::timestamptz
     )`,
    [
      args.id,
      args.creatorId,
      args.categoryId,
      args.title,
      args.description,
      args.keyFact,
      args.hashtags,
      args.searchText,
      args.storageKey,
      args.mimeType,
      args.sizeBytes,
      args.ownerTokenHash,
      args.submitterHash,
      args.expiresAt.toISOString(),
      args.now.toISOString(),
    ],
  );
}

export async function countPendingForDevice(db: SqlExecutor, submitterHash: string, now: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM videos
      WHERE submitter_hash = $1
        AND (status = 'pending_review' OR (status = 'pending_upload' AND expires_at > $2::timestamptz))`,
    [submitterHash, now.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countSubmissionsSince(
  db: SqlExecutor,
  submitterHash: string,
  since: Date,
  status?: VideoStatus,
): Promise<number> {
  const p = new ParamList();
  const device = p.ref(submitterHash, "text");
  const cutoff = p.ref(since.toISOString(), "timestamptz");
  const statusFilter = status ? `AND status = ${p.ref(status, "text")}` : "";
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM videos WHERE submitter_hash = ${device} AND created_at >= ${cutoff} ${statusFilter}`,
    p.values,
  );
  return Number(rows[0]?.n ?? 0);
}

export async function countUploadsSince(db: SqlExecutor, since: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM videos WHERE created_at >= $1::timestamptz AND NOT is_demo",
    [since.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function sumStoredBytes(db: SqlExecutor): Promise<number> {
  const rows = await db.query<{ total: number | string }>(
    `SELECT coalesce(sum(size_bytes), 0)::bigint AS total FROM videos
      WHERE NOT is_demo AND status IN ('pending_upload', 'pending_review', 'approved', 'hidden')`,
  );
  return Number(rows[0]?.total ?? 0);
}

export async function setVideoFilesAndStatus(
  db: SqlExecutor,
  id: string,
  fields: {
    status: VideoStatus;
    storageBucket?: "pending" | "public";
    storageKey?: string | null;
    durationMs?: number | null;
    width?: number | null;
    height?: number | null;
    moderationFlags?: string[];
    rejectionReason?: string | null;
    publishedAt?: Date | null;
    reviewedBy?: string | null;
    reviewedNow?: boolean;
    deletedNow?: boolean;
    now: Date;
  },
): Promise<void> {
  const p = new ParamList();
  const sets: string[] = [`status = ${p.ref(fields.status, "text")}`, `updated_at = ${p.ref(fields.now.toISOString(), "timestamptz")}`];
  if (fields.storageBucket !== undefined) sets.push(`storage_bucket = ${p.ref(fields.storageBucket, "text")}`);
  if (fields.storageKey !== undefined) sets.push(`storage_key = ${p.ref(fields.storageKey, "text")}`);
  if (fields.durationMs !== undefined) sets.push(`duration_ms = ${p.ref(fields.durationMs, "int")}`);
  if (fields.width !== undefined) sets.push(`width = ${p.ref(fields.width, "int")}`);
  if (fields.height !== undefined) sets.push(`height = ${p.ref(fields.height, "int")}`);
  if (fields.moderationFlags !== undefined) sets.push(`moderation_flags = ${p.ref(fields.moderationFlags, "text[]")}`);
  if (fields.rejectionReason !== undefined) sets.push(`rejection_reason = ${p.ref(fields.rejectionReason, "text")}`);
  if (fields.publishedAt !== undefined) {
    sets.push(`published_at = ${p.ref(fields.publishedAt ? fields.publishedAt.toISOString() : null, "timestamptz")}`);
  }
  if (fields.reviewedBy !== undefined) sets.push(`reviewed_by = ${p.ref(fields.reviewedBy, "text")}`);
  if (fields.reviewedNow) sets.push(`reviewed_at = ${p.ref(fields.now.toISOString(), "timestamptz")}`);
  if (fields.deletedNow) sets.push(`deleted_at = ${p.ref(fields.now.toISOString(), "timestamptz")}`);
  const videoId = p.ref(id, "uuid");
  await db.query(`UPDATE videos SET ${sets.join(", ")} WHERE id = ${videoId}`, p.values);
}

export async function updateOwnerTokenHash(db: SqlExecutor, id: string, hash: string, clearRecovery: boolean): Promise<void> {
  await db.query(
    `UPDATE videos SET owner_token_hash = $2, recovery_hash = CASE WHEN $3 THEN NULL ELSE recovery_hash END WHERE id = $1`,
    [id, hash, clearRecovery],
  );
}

export async function setRecoveryHash(db: SqlExecutor, id: string, hash: string): Promise<void> {
  await db.query("UPDATE videos SET recovery_hash = $2 WHERE id = $1", [id, hash]);
}

/** Owner edits are only allowed while the video waits for review. Text is re-checked by the caller. */
export async function updatePendingText(
  db: SqlExecutor,
  id: string,
  fields: {
    categoryId: string;
    title: string;
    description: string;
    keyFact: string | null;
    hashtags: string[];
    searchText: string;
    moderationFlags: string[];
    now: Date;
  },
): Promise<void> {
  await db.query(
    `UPDATE videos
        SET category_id = $2, title = $3, description = $4, key_fact = $5, hashtags = $6::text[],
            search_text = $7, moderation_flags = $8::text[], updated_at = $9::timestamptz
      WHERE id = $1`,
    [
      id,
      fields.categoryId,
      fields.title,
      fields.description,
      fields.keyFact,
      fields.hashtags,
      fields.searchText,
      fields.moderationFlags,
      fields.now.toISOString(),
    ],
  );
}

export interface AdminVideoRow {
  id: string;
  title: string;
  status: VideoStatus;
  created_at: Date | string;
  published_at: Date | string | null;
  size_bytes: number | string | null;
  duration_ms: number | string | null;
  mime_type: string | null;
  category_id: string;
  creator_name: string;
  creator_id: string;
  moderation_flags: string[];
  rejection_reason: string | null;
  is_featured: boolean;
  is_demo: boolean;
  report_count: number;
  like_count: number;
  view_count: number;
  submitter_hash: string | null;
  storage_bucket: string;
  storage_key: string | null;
  description: string;
  key_fact: string | null;
  hashtags: string[];
}

export async function listAdminVideos(
  db: SqlExecutor,
  args: { status: VideoStatus | null; text: string | null; offset: number; limit: number },
): Promise<AdminVideoRow[]> {
  const p = new ParamList();
  const status = p.ref(args.status, "text");
  const text = p.ref(args.text ? `%${escapeLike(args.text.toLowerCase())}%` : null, "text");
  const limit = p.ref(args.limit, "int");
  const offset = p.ref(args.offset, "int");
  return db.query<AdminVideoRow>(
    `SELECT v.id, v.title, v.status, v.created_at, v.published_at, v.size_bytes, v.duration_ms, v.mime_type,
            v.category_id, cr.display_name AS creator_name, cr.id AS creator_id, v.moderation_flags,
            v.rejection_reason, v.is_featured, v.is_demo, v.report_count, v.like_count, v.view_count,
            v.submitter_hash, v.storage_bucket, v.storage_key, v.description, v.key_fact, v.hashtags
       FROM videos v
       JOIN creators cr ON cr.id = v.creator_id
      WHERE (${status} IS NULL OR v.status = ${status})
        AND (${text} IS NULL OR lower(v.search_text) LIKE ${text} ESCAPE '\\')
      ORDER BY v.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    p.values,
  );
}

export async function countVideosByStatus(db: SqlExecutor): Promise<Record<string, number>> {
  const rows = await db.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM videos WHERE status <> 'deleted' GROUP BY status",
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.status] = Number(row.n);
  return result;
}

export async function expiredPendingUploads(db: SqlExecutor, now: Date): Promise<Array<{ id: string; storage_key: string | null }>> {
  return db.query<{ id: string; storage_key: string | null }>(
    `UPDATE videos SET status = 'expired', updated_at = $1::timestamptz
      WHERE status = 'pending_upload' AND expires_at < $1::timestamptz
      RETURNING id, storage_key`,
    [now.toISOString()],
  );
}

export async function purgeOldClosedVideos(
  db: SqlExecutor,
  cutoff: Date,
): Promise<Array<{ id: string; storage_bucket: string; storage_key: string | null }>> {
  return db.query<{ id: string; storage_bucket: string; storage_key: string | null }>(
    `DELETE FROM videos
      WHERE status IN ('rejected', 'expired', 'deleted')
        AND NOT is_demo
        AND coalesce(reviewed_at, updated_at, created_at) < $1::timestamptz
      RETURNING id, storage_bucket, storage_key`,
    [cutoff.toISOString()],
  );
}
