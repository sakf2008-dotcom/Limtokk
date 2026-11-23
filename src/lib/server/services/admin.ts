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

