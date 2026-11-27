import { z } from "zod";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import { isUuid } from "../db/params";
import { ApiError } from "../http";
import { getSettings, saveSettings, SETTING_LIMITS, type PlatformSettings } from "../settings";
import {
  appendAudit,
  blockDevice,
  countHeldComments,
  countOpenReportsTotal,
  listAudit,
  recentDailyStats,
  totalsForDashboard,
  unblockDevice,
} from "../repo/ops";
import { countVideosByStatus, sumStoredBytes } from "../repo/videos";
import { isStorageAvailable } from "../storage";
import { runCleanup, type CleanupSummary } from "./cleanup";
import type { CategoryDto } from "@/lib/domain/types";

/** Admin-only reads and configuration writes. Callers must have verified the admin session. */

export interface OverviewDto {
  totals: Awaited<ReturnType<typeof totalsForDashboard>>;
  statusCounts: Record<string, number>;
  openReports: number;
  heldComments: number;
  storedBytes: number;
  storageLimitBytes: number;
  storageAvailable: boolean;
  demoMode: boolean;
  daily: Awaited<ReturnType<typeof recentDailyStats>>;
  recentAudit: Awaited<ReturnType<typeof listAudit>>;
}

export async function getOverview(now: Date = new Date()): Promise<OverviewDto> {
  const db = await getDb();
  const settings = await getSettings(db);
  const [totals, statusCounts, openReports, heldComments, storedBytes, daily, recentAudit] = await Promise.all([
    totalsForDashboard(db),
    countVideosByStatus(db),
    countOpenReportsTotal(db),
    countHeldComments(db),
    sumStoredBytes(db),
    recentDailyStats(db, 14, now),
    listAudit(db, 0, 12),
  ]);
  return {
    totals,
    statusCounts,
    openReports,
    heldComments,
    storedBytes,
    storageLimitBytes: settings.maxStorageBytesTotal,
    storageAvailable: isStorageAvailable(),
    demoMode: getConfig().demoMode,
    daily,
    recentAudit,
  };
}

const categoryUpdateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  nameAr: z.string().trim().min(2).max(40),
  descriptionAr: z.string().trim().max(200).default(""),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  icon: z.string().trim().min(2).max(40),
  sortOrder: z.number().int().min(0).max(1000),
  isActive: z.boolean(),
});

export async function listAllCategories(): Promise<Array<CategoryDto & { isActive: boolean }>> {
  const db = await getDb();
  const rows = await db.query<{
    id: string;
    name_ar: string;
    description_ar: string;
    accent: string;
    icon: string;
    sort_order: number;
    is_active: boolean;
  }>("SELECT id, name_ar, description_ar, accent, icon, sort_order, is_active FROM categories ORDER BY sort_order, name_ar");
  return rows.map((row) => ({
    id: row.id,
    nameAr: row.name_ar,
    descriptionAr: row.description_ar,
    accent: row.accent,
    icon: row.icon,
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
  }));
}

export async function updateCategoryByAdmin(body: unknown, actor: string): Promise<void> {
  const input = categoryUpdateSchema.parse(body);
  const db = await getDb();
  const updated = await db.query<{ id: string }>(
    `UPDATE categories SET name_ar = $2, description_ar = $3, accent = $4, icon = $5,
            sort_order = $6, is_active = $7, updated_at = now()
      WHERE id = $1 RETURNING id`,
    [input.id, input.nameAr, input.descriptionAr, input.accent, input.icon, input.sortOrder, input.isActive],
  );
  if (updated.length === 0) throw new ApiError(404, "not_found", "التصنيف غير موجود.");
  await appendAudit(db, { actor, action: "category.update", targetType: "category", targetId: input.id, details: { isActive: input.isActive } });
}

export const settingsPatchSchema = z
  .object({
    maxUploadBytes: z.number().int().optional(),
    maxDurationSeconds: z.number().int().optional(),
    minDurationSeconds: z.number().int().optional(),
    maxPendingPerDevice: z.number().int().optional(),
    maxSubmissionsPerDeviceDay: z.number().int().optional(),
    maxUploadsPerDayGlobal: z.number().int().optional(),
    maxStorageBytesTotal: z.number().int().optional(),
    pendingExpiryMinutes: z.number().int().optional(),
    rejectedRetentionDays: z.number().int().optional(),
    reportAutoHideThreshold: z.number().int().optional(),
    commentsEnabled: z.boolean().optional(),
    commentChallengeAfterRecent: z.number().int().optional(),
    extraBlockedTerms: z.array(z.string().trim().min(2).max(40)).max(200).optional(),
  })
  .strict();

export async function updateSettingsByAdmin(body: unknown, actor: string): Promise<PlatformSettings> {
  const patch = settingsPatchSchema.parse(body) as Partial<PlatformSettings>;
  for (const [field, value] of Object.entries(patch)) {
    const limit = SETTING_LIMITS[field as keyof PlatformSettings];
    if (limit && typeof value === "number" && (value < limit.min || value > limit.max)) {
      throw new ApiError(422, "setting_out_of_range", `القيمة خارج النطاق المسموح به (${limit.min} إلى ${limit.max}).`, {
        field,
      });
    }
  }
  const db = await getDb();
  await saveSettings(db, patch, actor);
  await appendAudit(db, { actor, action: "settings.update", targetType: "settings", targetId: null, details: { fields: Object.keys(patch) } });
  return getSettings(db);
}

const quizSchema = z.object({
  videoId: z.string().refine(isUuid, "رقم الفيديو غير صالح"),
  question: z.string().trim().min(5).max(200),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(5).max(300),
});

export async function createQuizByAdmin(body: unknown, actor: string): Promise<string> {
  const input = quizSchema.parse(body);
  if (input.correctIndex >= input.options.length) {
    throw new ApiError(422, "invalid_quiz", "رقم الإجابة الصحيحة يتجاوز عدد الخيارات.");
  }
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO quizzes (video_id, question, options, correct_index, explanation)
     SELECT v.id, $2, $3::jsonb, $4, $5 FROM videos v WHERE v.id = $1::uuid AND v.status = 'approved'
     RETURNING id`,
    [input.videoId, input.question, JSON.stringify(input.options), input.correctIndex, input.explanation],
  );
  if (rows.length === 0) throw new ApiError(404, "not_found", "الفيديو المنشور غير موجود.");
  await appendAudit(db, { actor, action: "quiz.create", targetType: "video", targetId: input.videoId, details: { quizId: rows[0]?.id } });
  return rows[0]?.id ?? "";
}

export async function deleteQuizByAdmin(id: string, actor: string): Promise<void> {
  if (!isUuid(id)) throw new ApiError(404, "not_found", "السؤال غير موجود.");
  const db = await getDb();
  const rows = await db.query<{ video_id: string }>("DELETE FROM quizzes WHERE id = $1::uuid RETURNING video_id", [id]);
  if (rows.length === 0) throw new ApiError(404, "not_found", "السؤال غير موجود.");
  await appendAudit(db, { actor, action: "quiz.delete", targetType: "video", targetId: rows[0]?.video_id ?? null, details: { quizId: id } });
}

/* ----- Quizzes: the questions of one video, for the moderation console ----- */

export interface AdminQuizDto {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

function asOptions(value: unknown): string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

export async function listQuizzesByVideo(videoId: string): Promise<AdminQuizDto[]> {
  if (!isUuid(videoId)) throw new ApiError(422, "invalid_video", "رقم الفيديو غير صالح.");
  const db = await getDb();
  const rows = await db.query<{ id: string; question: string; options: unknown; correct_index: number; explanation: string }>(
    `SELECT id, question, options, correct_index, explanation
       FROM quizzes
      WHERE video_id = $1::uuid
      ORDER BY created_at, id`,
    [videoId],
  );
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    options: asOptions(row.options),
    correctIndex: Number(row.correct_index),
    explanation: row.explanation,
  }));
}

/* ----- Learning paths (playlists) ----- */

export interface AdminPlaylistDto {
  id: string;
  slug: string;
  titleAr: string;
  descriptionAr: string;
  sortOrder: number;
  isActive: boolean;
  items: Array<{ videoId: string; title: string; position: number; status: string }>;
}

export async function listPlaylistsAdmin(): Promise<AdminPlaylistDto[]> {
  const db = await getDb();
  const playlists = await db.query<{
    id: string;
    slug: string;
    title_ar: string;
    description_ar: string;
    sort_order: number;
    is_active: boolean;
  }>("SELECT id, slug, title_ar, description_ar, sort_order, is_active FROM playlists ORDER BY sort_order, title_ar");
  // Unpublished videos stay visible here, so the admin can see and remove them. The public page hides them.
  const items = await db.query<{ playlist_id: string; video_id: string; position: number; title: string; status: string }>(
    `SELECT pi.playlist_id, pi.video_id, pi.position, v.title, v.status
       FROM playlist_items pi
       JOIN videos v ON v.id = pi.video_id
      ORDER BY pi.position`,
  );
  return playlists.map((playlist) => ({
    id: playlist.id,
    slug: playlist.slug,
    titleAr: playlist.title_ar,
    descriptionAr: playlist.description_ar,
    sortOrder: Number(playlist.sort_order),
    isActive: Boolean(playlist.is_active),
    items: items
      .filter((item) => item.playlist_id === playlist.id)
      .map((item) => ({ videoId: item.video_id, title: item.title, position: Number(item.position), status: item.status })),
  }));
}

const playlistFieldsSchema = z.object({
  titleAr: z.string().trim().min(2).max(80),
  descriptionAr: z.string().trim().max(300).default(""),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

const playlistCreateSchema = playlistFieldsSchema.extend({
  slug: z.string().trim().regex(/^[a-z0-9-]{3,60}$/, "الرابط المختصر يكون بأحرف إنجليزية صغيرة وأرقام وشرطات فقط."),
});

const playlistUpdateSchema = playlistFieldsSchema.extend({
  id: z.string().refine(isUuid, "رقم المسار غير صالح"),
});

const playlistItemSchema = z.object({
  playlistId: z.string().refine(isUuid, "رقم المسار غير صالح"),
  videoId: z.string().refine(isUuid, "رقم الفيديو غير صالح"),
});

export async function createPlaylistByAdmin(body: unknown, actor: string): Promise<string> {
  const input = playlistCreateSchema.parse(body);
  const db = await getDb();
  const rows = await db.query<{ id: string }>(
    `INSERT INTO playlists (slug, title_ar, description_ar, sort_order, is_active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO NOTHING
     RETURNING id`,
    [input.slug, input.titleAr, input.descriptionAr, input.sortOrder, input.isActive],
  );
  const id = rows[0]?.id;
  if (!id) throw new ApiError(409, "slug_taken", "هذا الرابط المختصر مستخدم لمسار آخر.");
  await appendAudit(db, { actor, action: "playlist.create", targetType: "playlist", targetId: id, details: { slug: input.slug } });
  return id;
}

export async function updatePlaylistByAdmin(body: unknown, actor: string): Promise<void> {
  const input = playlistUpdateSchema.parse(body);
  const db = await getDb();
  // The slug is part of the public address, so it does not change after creation.
  const rows = await db.query<{ id: string }>(
    `UPDATE playlists
        SET title_ar = $2, description_ar = $3, sort_order = $4, is_active = $5
      WHERE id = $1::uuid
      RETURNING id`,
    [input.id, input.titleAr, input.descriptionAr, input.sortOrder, input.isActive],
  );
  if (rows.length === 0) throw new ApiError(404, "not_found", "المسار غير موجود.");
  await appendAudit(db, { actor, action: "playlist.update", targetType: "playlist", targetId: input.id, details: { isActive: input.isActive } });
}

export async function deletePlaylistByAdmin(id: string, actor: string): Promise<void> {
  if (!isUuid(id)) throw new ApiError(404, "not_found", "المسار غير موجود.");
  const db = await getDb();
  const rows = await db.query<{ slug: string }>("DELETE FROM playlists WHERE id = $1::uuid RETURNING slug", [id]);
  if (rows.length === 0) throw new ApiError(404, "not_found", "المسار غير موجود.");
  await appendAudit(db, { actor, action: "playlist.delete", targetType: "playlist", targetId: id, details: { slug: rows[0]?.slug ?? "" } });
}

export async function addPlaylistItemByAdmin(body: unknown, actor: string): Promise<void> {
  const input = playlistItemSchema.parse(body);
  const db = await getDb();
  const playlist = await db.query<{ id: string }>("SELECT id FROM playlists WHERE id = $1::uuid", [input.playlistId]);
  if (playlist.length === 0) throw new ApiError(404, "not_found", "المسار غير موجود.");
  const video = await db.query<{ status: string }>("SELECT status FROM videos WHERE id = $1::uuid", [input.videoId]);
  if (video[0]?.status !== "approved") {
    throw new ApiError(422, "video_not_published", "لا يمكن إضافة فيديو غير منشور إلى مسار.");
  }
  const rows = await db.query<{ video_id: string }>(
    `INSERT INTO playlist_items (playlist_id, video_id, position)
     VALUES ($1::uuid, $2::uuid,
             COALESCE((SELECT max(i.position) + 1 FROM playlist_items i WHERE i.playlist_id = $1::uuid), 0))
     ON CONFLICT (playlist_id, video_id) DO NOTHING
     RETURNING video_id`,
    [input.playlistId, input.videoId],
  );
  if (rows.length === 0) throw new ApiError(409, "already_in_playlist", "الفيديو موجود في هذا المسار بالفعل.");
  await appendAudit(db, { actor, action: "playlist.add_video", targetType: "playlist", targetId: input.playlistId, details: { videoId: input.videoId } });
}

export async function removePlaylistItemByAdmin(body: unknown, actor: string): Promise<void> {
  const input = playlistItemSchema.parse(body);
  const db = await getDb();
  const rows = await db.query<{ video_id: string }>(
    "DELETE FROM playlist_items WHERE playlist_id = $1::uuid AND video_id = $2::uuid RETURNING video_id",
    [input.playlistId, input.videoId],
  );
  if (rows.length === 0) throw new ApiError(404, "not_found", "الفيديو غير موجود في هذا المسار.");
  await appendAudit(db, { actor, action: "playlist.remove_video", targetType: "playlist", targetId: input.playlistId, details: { videoId: input.videoId } });
}

const blockSchema = z.object({
  deviceHash: z.string().regex(/^[0-9a-f]{64}$/, "معرّف الجهاز غير صالح"),
  hours: z.number().int().min(1).max(24 * 365),
  reason: z.string().trim().min(3).max(200),
});

export async function blockDeviceByAdmin(body: unknown, actor: string, now: Date = new Date()): Promise<void> {
  const input = blockSchema.parse(body);
  const db = await getDb();
  await blockDevice(db, input.deviceHash, input.reason, new Date(now.getTime() + input.hours * 3_600_000));
  await appendAudit(db, { actor, action: "device.block", targetType: "device", targetId: input.deviceHash.slice(0, 12), details: { hours: input.hours, reason: input.reason } });
}

export async function unblockDeviceByAdmin(deviceHash: string, actor: string): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(deviceHash)) throw new ApiError(400, "invalid_device", "معرّف الجهاز غير صالح.");
  const db = await getDb();
  await unblockDevice(db, deviceHash);
  await appendAudit(db, { actor, action: "device.unblock", targetType: "device", targetId: deviceHash.slice(0, 12), details: {} });
}

export async function runCleanupByAdmin(actor: string): Promise<CleanupSummary> {
  const summary = await runCleanup();
  const db = await getDb();
  await appendAudit(db, { actor, action: "maintenance.cleanup", targetType: "system", targetId: null, details: { ...summary } });
  return summary;
}

