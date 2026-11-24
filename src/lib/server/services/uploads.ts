import { z } from "zod";
import { getDb, type Sql } from "../db/client";
import { isUuid } from "../db/params";
import { ApiError, bearerToken, clientIpHash, requireDeviceHash } from "../http";
import {
  hmacHex,
  newId,
  normalizeRecoveryCode,
  randomRecoveryCode,
  randomToken,
  safeEqualHex,
} from "../crypto";
import { getSettings, type PlatformSettings } from "../settings";
import { enforceRate } from "../rate-limit";
import { verifyAndConsumePow } from "../pow";
import { analyzeText, FLAG_LABELS_AR, type TextFlag } from "../moderation";
import {
  BUCKET_PENDING,
  BUCKET_PUBLIC,
  getBlobStore,
  isStorageAvailable,
  StorageUnavailableError,
  type BlobStore,
  type UploadTarget,
} from "../storage";
import { MediaProbeError, probeMp4, type ProbeReason, type RangeReader } from "../media/mp4";
import {
  countPendingForDevice,
  countSubmissionsSince,
  countUploadsSince,
  findOwnCreator,
  getVideoRecord,
  insertCreator,
  insertVideo,
  setRecoveryHash,
  setVideoFilesAndStatus,
  sumStoredBytes,
  updateCreatorIdentity,
  updateOwnerTokenHash,
  updatePendingText,
  type VideoRecord,
} from "../repo/videos";
import { categoryExists } from "../repo/catalog";
import { appendAudit, blockDevice, bumpDailyStat, isDeviceBlocked } from "../repo/ops";
import { buildSearchText, parseHashtags } from "@/lib/domain/text";
import type { VideoStatus } from "@/lib/domain/types";

/** Accepted containers. Browsers and iPhones record H.264/HEVC in MP4 or QuickTime (.mov). */
const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
};
const EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export const STATUS_LABEL_AR: Record<VideoStatus, string> = {
  pending_upload: "بانتظار اكتمال الرفع",
  pending_review: "قيد المراجعة اليدوية",
  approved: "منشور للجمهور",
  rejected: "مرفوض",
  hidden: "مخفي مؤقتًا",
  expired: "انتهت مهلة الرفع",
  deleted: "محذوف",
};

const PROBE_MESSAGES: Record<ProbeReason, string> = {
  not_mp4: "الملف ليس فيديو MP4 أو MOV صالحًا.",
  unsupported_brand: "صيغة الحاوية غير مدعومة. استخدم MP4 أو MOV.",
  no_moov: "بنية الملف غير مكتملة. أعد تصدير الفيديو ثم حاول مرة أخرى.",
  moov_too_large: "بيانات الفيديو الوصفية كبيرة بشكل غير معتاد.",
  invalid_box: "بنية الملف تالفة أو غير مكتملة.",
  too_many_boxes: "بنية الملف معقدة بشكل غير معتاد.",
  no_video_track: "الملف لا يحتوي على مسار فيديو.",
  unsupported_codec: "ترميز الفيديو غير مدعوم. استخدم H.264 أو HEVC.",
  invalid_duration: "مدة الفيديو غير صالحة.",
  invalid_dimensions: "أبعاد الفيديو غير صالحة.",
};

const NICKNAME_PATTERN = /^[\p{L}\p{M}\p{N} _.-]+$/u;

const challengeSchema = z.object({
  token: z.string().min(10).max(500),
  nonce: z.string().min(1).max(20),
});

export const initUploadSchema = z.object({
  fileName: z.string().min(1).max(160),
  mimeType: z.string().max(100).default(""),
  sizeBytes: z.number().int().positive().max(2_147_483_647),
  declaredDurationMs: z.number().int().nonnegative().max(3_600_000).optional(),
  nickname: z
    .string()
    .trim()
    .min(2, "الاسم المستعار قصير جدًا")
    .max(24, "الاسم المستعار طويل جدًا")
    .regex(NICKNAME_PATTERN, "الاسم المستعار يقبل الحروف والأرقام والمسافة و _ . -"),
  title: z.string().trim().min(4, "العنوان قصير جدًا").max(80, "العنوان طويل جدًا"),
  description: z.string().trim().max(500, "الوصف طويل جدًا").default(""),
  keyFact: z.string().trim().max(160, "المعلومة الأساسية طويلة جدًا").nullish(),
  categoryId: z.string().regex(/^[a-z0-9-]{2,40}$/, "اختر تصنيفًا"),
  hashtags: z.string().max(200).default(""),
  acceptedGuidelines: z.literal(true, { message: "يلزم الموافقة على إرشادات المجتمع" }),
  creatorId: z.string().nullish(),
  challenge: challengeSchema,
});

export type InitUploadInput = z.infer<typeof initUploadSchema>;

export const ownerEditSchema = z
  .object({
    title: z.string().trim().min(4).max(80).optional(),
    description: z.string().trim().max(500).optional(),
    keyFact: z.string().trim().max(160).nullish(),
    hashtags: z.string().max(200).optional(),
    categoryId: z.string().regex(/^[a-z0-9-]{2,40}$/).optional(),
  })
  .strict();

export function resolveMime(fileName: string, declaredMime: string): string | null {
  const declared = declaredMime.trim().toLowerCase();
  if (declared === "video/mp4" || declared === "video/quicktime") return declared;
  // Some systems report an empty or generic type for .mov files. Fall back to the extension.
  if (declared === "" || declared === "application/octet-stream") {
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return MIME_BY_EXTENSION[ext] ?? null;
  }
  return null;
}

function ownerMatches(record: VideoRecord, token: string): boolean {
  return safeEqualHex(record.owner_token_hash, hmacHex(token, "owner"));
}

async function requireOwner(db: Sql, req: Request, videoId: string): Promise<VideoRecord> {
  if (!isUuid(videoId)) throw new ApiError(404, "not_found", "الفيديو غير موجود.");
  const token = bearerToken(req);
  if (!token) {
    throw new ApiError(401, "owner_token_required", "هذا الإجراء يتطلب رمز الإدارة المحفوظ على هذا الجهاز.");
  }
  const record = await getVideoRecord(db, videoId);
  if (!record || record.status === "deleted") throw new ApiError(404, "not_found", "الفيديو غير موجود.");
  if (!ownerMatches(record, token)) {
    throw new ApiError(403, "owner_mismatch", "رمز الإدارة لا يطابق هذا الفيديو. تأكد من الجهاز أو استخدم رمز الاسترداد.");
  }
  return record;
}

function storageReader(store: BlobStore, key: string, size: number): RangeReader {
  return {
    size,
    read: async (start: number, length: number) => {
      const bytes = await store.readRange(BUCKET_PENDING, key, start, length);
      if (bytes.length !== length) throw new MediaProbeError("invalid_box");
      return bytes;
    },
  };
}

async function removeStoredObject(store: BlobStore | null, record: { storage_bucket: string; storage_key: string | null }): Promise<void> {
  if (!store || !record.storage_key) return;
  if (record.storage_bucket !== "pending" && record.storage_bucket !== "public") return;
  const bucket = record.storage_bucket === "pending" ? BUCKET_PENDING : BUCKET_PUBLIC;
  try {
    await store.remove(bucket, [record.storage_key]);
  } catch (error) {
    // Cleanup is retried by the scheduled job. A failed delete must not hide the decision.
    console.error("[storage] delete failed, will be retried by cleanup:", error);
  }
}

export interface InitUploadResult {
  videoId: string;
  creatorId: string;
  ownerToken: string;
  upload: UploadTarget;
  expiresAt: string;
  status: VideoStatus;
  maxBytes: number;
  maxDurationSeconds: number;
  flags: TextFlag[];
}

/**
 * Step 1 of an upload. Performs every server-side check before any bytes are accepted:
 * storage availability, device blocks, rate limits, quotas, file type and size, proof of work.
 */
export async function initUpload(req: Request, body: unknown, now: Date = new Date()): Promise<InitUploadResult> {
  const input = initUploadSchema.parse(body);
  const db = await getDb();
  const settings = await getSettings(db);
  const deviceHash = requireDeviceHash(req);
  const ipHash = clientIpHash(req);

  if (!isStorageAvailable()) throw new StorageUnavailableError();
  if (await isDeviceBlocked(db, deviceHash, now)) {
    throw new ApiError(
      403,
      "device_blocked",
      "أُوقف إرسال الفيديوهات مؤقتًا من هذا الجهاز بسبب مخالفات متكررة. راجع سياسة المجتمع للتفاصيل.",
    );
  }

  await enforceRate(db, `ip:${ipHash}:upload-init`, 30, 3600, undefined, now);
  await enforceRate(db, `dev:${deviceHash}:upload-init`, 8, 3600, undefined, now);

  const rejectedLastDay = await countSubmissionsSince(db, deviceHash, new Date(now.getTime() - 86_400_000), "rejected");
  if (rejectedLastDay >= 3) {
    await blockDevice(db, deviceHash, "auto: repeated rejected uploads", new Date(now.getTime() + 86_400_000));
    throw new ApiError(
      403,
      "device_blocked",
      "أُوقف إرسال الفيديوهات مؤقتًا من هذا الجهاز بسبب مخالفات متكررة. راجع سياسة المجتمع للتفاصيل.",
    );
  }

  await checkQuotas(db, deviceHash, input.sizeBytes, settings, now);

  const mimeType = resolveMime(input.fileName, input.mimeType);
  if (!mimeType) {
    throw new ApiError(415, "unsupported_format", "صيغة الملف غير مدعومة. اختر فيديو MP4 أو MOV من الصور.");
  }
  if (input.sizeBytes > settings.maxUploadBytes) {
    throw new ApiError(413, "file_too_large", "حجم الملف أكبر من الحد المسموح به.", {
      maxBytes: settings.maxUploadBytes,
    });
  }
  if (input.declaredDurationMs !== undefined && input.declaredDurationMs > settings.maxDurationSeconds * 1000) {
    throw new ApiError(422, "duration_too_long", `مدة الفيديو تتجاوز ${settings.maxDurationSeconds} ثانية.`);
  }
  if (!(await categoryExists(db, input.categoryId))) {
    throw new ApiError(400, "invalid_category", "التصنيف المختار غير متاح.");
  }

  // Proof of work comes after the cheap checks, so invalid requests never consume a challenge.
  await verifyAndConsumePow(input.challenge, now, db);

  const hashtags = parseHashtags(input.hashtags);
  const keyFact = input.keyFact?.trim() ? input.keyFact.trim() : null;
  const flags = analyzeText(
    [input.nickname, input.title, input.description, keyFact ?? "", hashtags.join(" ")].join("\n"),
    settings.extraBlockedTerms,
  );

  const creatorId = await resolveCreator(db, input, deviceHash);
  const videoId = newId();
  const ownerToken = randomToken(32);
  const extension = EXTENSION_BY_MIME[mimeType] ?? "mp4";
  const storageKey = `${videoId}/${randomToken(12)}.${extension}`;
  const expiresAt = new Date(now.getTime() + settings.pendingExpiryMinutes * 60_000);

  await insertVideo(db, {
    id: videoId,
    creatorId,
    categoryId: input.categoryId,
    title: input.title,
    description: input.description,
    keyFact,
    hashtags,
    searchText: buildSearchText([input.title, input.description, keyFact, input.nickname], hashtags),
    storageKey,
    mimeType,
    sizeBytes: input.sizeBytes,
    ownerTokenHash: hmacHex(ownerToken, "owner"),
    submitterHash: deviceHash,
    expiresAt,
    now,
  });

  await appendAudit(db, {
    actor: `device:${deviceHash.slice(0, 12)}`,
    action: "upload.init",
    targetType: "video",
    targetId: videoId,
    details: { sizeBytes: input.sizeBytes, flags },
  });

  const store = getBlobStore();
  const upload = await store.createUploadTarget({
    videoId,
    bucket: BUCKET_PENDING,
    key: storageKey,
    contentType: mimeType,
  });

  return {
    videoId,
    creatorId,
    ownerToken,
    // Demo storage has no signed URLs, so the owner token authorizes the byte upload instead.
    upload: store.mode === "demo" || store.mode === "r2" ? { ...upload, headers: { ...upload.headers, Authorization: `Bearer ${ownerToken}` } } : upload,
    expiresAt: expiresAt.toISOString(),
    status: "pending_upload",
    maxBytes: settings.maxUploadBytes,
    maxDurationSeconds: settings.maxDurationSeconds,
    flags,
  };
}

async function checkQuotas(db: Sql, deviceHash: string, sizeBytes: number, settings: PlatformSettings, now: Date): Promise<void> {
  const pending = await countPendingForDevice(db, deviceHash, now);
  if (pending >= settings.maxPendingPerDevice) {
    throw new ApiError(
      409,
      "pending_exists",
      "لديك فيديو قيد الرفع أو المراجعة. انتظر اكتمال مراجعته قبل إرسال فيديو جديد.",
    );
  }
  const today = await countSubmissionsSince(db, deviceHash, new Date(now.getTime() - 86_400_000));
  if (today >= settings.maxSubmissionsPerDeviceDay) {
    throw new ApiError(429, "daily_quota", "وصلت إلى الحد اليومي لإرسال الفيديوهات. حاول مرة أخرى غدًا.");
  }
  const globalToday = await countUploadsSince(db, new Date(now.getTime() - 86_400_000));
  if (globalToday >= settings.maxUploadsPerDayGlobal) {
    throw new ApiError(503, "global_daily_limit", "استقبال الفيديوهات مؤقتًا بلغ حده اليومي. حاول لاحقًا.");
  }
  const stored = await sumStoredBytes(db);
  if (stored + sizeBytes > settings.maxStorageBytesTotal) {
    throw new ApiError(507, "storage_full", "مساحة التخزين المخصصة لاستقبال الفيديوهات ممتلئة مؤقتًا.");
  }
}

async function resolveCreator(db: Sql, input: InitUploadInput, deviceHash: string): Promise<string> {
  if (input.creatorId && isUuid(input.creatorId)) {
    const own = await findOwnCreator(db, input.creatorId, deviceHash);
    if (own) {
      if (own.display_name !== input.nickname) {
        await updateCreatorIdentity(db, own.id, input.nickname, own.avatar_key);
      }
      return own.id;
    }
  }
  // A new pseudonymous creator page. Two devices can use the same nickname; they remain separate.
  return insertCreator(db, {
    displayName: input.nickname,
    avatarKey: avatarKeyFor(deviceHash),
    deviceHash,
  });
}

/** Deterministic avatar from the device hash. It is cosmetic and never identifies anyone. */
export function avatarKeyFor(seed: string): string {
  const index = (Number.parseInt(seed.slice(0, 2), 16) % 12) + 1;
  return `a${index}`;
}

/**
 * Demo storage only: receives the file bytes for a pending upload. In Supabase mode the browser
 * uploads straight to a signed URL instead, and this endpoint is never used.
 */
export async function receiveDemoContent(req: Request, videoId: string): Promise<void> {
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);
  if (record.status !== "pending_upload") {
    throw new ApiError(409, "not_accepting_upload", "هذا الفيديو لا يقبل ملفًا جديدًا.");
  }
  if (!record.storage_key) throw new ApiError(409, "not_accepting_upload", "هذا الفيديو لا يقبل ملفًا جديدًا.");
  const store = getBlobStore();
  if (store.mode !== "demo" && store.mode !== "r2") throw new ApiError(404, "not_found", "الصفحة غير متاحة.");

  const declared = Number(record.size_bytes ?? 0);
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > declared) {
    throw new ApiError(413, "file_too_large", "حجم الملف المرفوع يختلف عن الحجم المعلن.");
  }
  if (store.mode === "r2") {
    // Cloudflare: the body streams straight into R2 and is never held whole in memory.
    // The exact length is enforced by the stream, so a body that does not match is refused.
    if (!req.body || contentLength <= 0) throw new ApiError(411, "length_required", "يلزم تحديد حجم الملف.");
    await store.putStream(BUCKET_PENDING, record.storage_key, req.body, contentLength);
    return;
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > declared) {
    throw new ApiError(413, "file_too_large", "حجم الملف المرفوع يختلف عن الحجم المعلن.");
  }
  await store.writeFile(BUCKET_PENDING, record.storage_key, bytes);
}

export interface CompleteUploadResult {
  videoId: string;
  status: VideoStatus;
  message: string;
  rejectionReason: string | null;
}

/**
 * Step 2: the browser reports that the bytes are uploaded. The server verifies the real file:
 * size, container structure, duration, dimensions and codec. Anything that fails is deleted
 * immediately. Anything that passes waits for a human decision in the moderation queue.
 */
export async function completeUpload(req: Request, videoId: string, now: Date = new Date()): Promise<CompleteUploadResult> {
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);

  if (record.status !== "pending_upload") {
    return {
      videoId,
      status: record.status,
      message: STATUS_LABEL_AR[record.status],
      rejectionReason: record.rejection_reason,
    };
  }

  const settings = await getSettings(db);
  const store = getBlobStore();
  const declaredSize = Number(record.size_bytes ?? 0);

  if (new Date(record.expires_at ?? 0).getTime() < now.getTime() || !record.storage_key) {
    await setVideoFilesAndStatus(db, videoId, { status: "expired", now, reviewedNow: false });
    await removeStoredObject(store, { storage_bucket: "pending", storage_key: record.storage_key });
    throw new ApiError(410, "upload_expired", "انتهت مهلة الرفع. ابدأ إرسال الفيديو من جديد.");
  }

  const info = await store.stat(BUCKET_PENDING, record.storage_key);
  if (!info) {
    throw new ApiError(409, "file_missing", "لم يصل الملف بعد إلى التخزين. أعد الرفع ثم حاول مرة أخرى.");
  }
  if (info.size !== declaredSize) {
    return rejectUpload(db, store, record, `الحجم الفعلي (${info.size} بايت) لا يطابق الحجم المعلن.`, now, "size_mismatch");
  }
  if (info.size > settings.maxUploadBytes) {
    return rejectUpload(db, store, record, "الملف أكبر من الحد المسموح به.", now, "too_large");
  }

  let probe;
  try {
    probe = await probeMp4(storageReader(store, record.storage_key, info.size));
  } catch (error) {
    if (error instanceof MediaProbeError) {
      return rejectUpload(db, store, record, PROBE_MESSAGES[error.reason], now, error.reason);
    }
    throw error;
  }

  if (probe.durationMs < settings.minDurationSeconds * 1000) {
    return rejectUpload(db, store, record, `مدة الفيديو قصيرة جدًا (الحد الأدنى ${settings.minDurationSeconds} ثانية).`, now, "too_short");
  }
  if (probe.durationMs > settings.maxDurationSeconds * 1000) {
    return rejectUpload(db, store, record, `مدة الفيديو تتجاوز ${settings.maxDurationSeconds} ثانية.`, now, "too_long");
  }

  await setVideoFilesAndStatus(db, videoId, {
    status: "pending_review",
    durationMs: probe.durationMs,
    width: probe.width,
    height: probe.height,
    moderationFlags: record.moderation_flags,
    now,
  });
  await db.query("UPDATE videos SET size_bytes = $2 WHERE id = $1", [videoId, info.size]);
  await bumpDailyStat(db, "uploads", 1, now, info.size);
  await appendAudit(db, {
    actor: "system",
    action: "upload.verified",
    targetType: "video",
    targetId: videoId,
    details: { durationMs: probe.durationMs, width: probe.width, height: probe.height, codec: probe.videoCodec },
  });

  return {
    videoId,
    status: "pending_review",
    message: "تم استلام الفيديو وفحصه تقنيًا. سيظهر للجمهور بعد مراجعة بشرية.",
    rejectionReason: null,
  };
}

async function rejectUpload(
  db: Sql,
  store: BlobStore,
  record: VideoRecord,
  reason: string,
  now: Date,
  code: string,
): Promise<CompleteUploadResult> {
  await setVideoFilesAndStatus(db, record.id, {
    status: "rejected",
    rejectionReason: reason,
    reviewedNow: true,
    now,
  });
  await removeStoredObject(store, { storage_bucket: "pending", storage_key: record.storage_key });
  await bumpDailyStat(db, "rejections", 1, now);
  await appendAudit(db, {
    actor: "system",
    action: "upload.rejected_automatically",
    targetType: "video",
    targetId: record.id,
    details: { code },
  });
  return { videoId: record.id, status: "rejected", message: reason, rejectionReason: reason };
}

export interface OwnerVideoStatus {
  id: string;
  title: string;
  status: VideoStatus;
  statusLabel: string;
  rejectionReason: string | null;
  createdAt: string;
  publishedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  flagsLabels: string[];
}

export async function getOwnerStatus(req: Request, videoId: string): Promise<OwnerVideoStatus> {
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    statusLabel: STATUS_LABEL_AR[record.status],
    rejectionReason: record.rejection_reason,
    createdAt: new Date(record.created_at).toISOString(),
    publishedAt: record.published_at ? new Date(record.published_at).toISOString() : null,
    canEdit: record.status === "pending_review",
    canDelete: record.status !== "deleted",
    flagsLabels: record.moderation_flags
      .filter((flag): flag is TextFlag => flag in FLAG_LABELS_AR)
      .map((flag) => FLAG_LABELS_AR[flag]),
  };
}

export async function editOwnerVideo(req: Request, videoId: string, body: unknown, now: Date = new Date()): Promise<void> {
  const input = ownerEditSchema.parse(body);
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);
  if (record.status !== "pending_review") {
    throw new ApiError(409, "edit_locked", "لا يمكن تعديل الفيديو بعد نشره أو رفضه. يمكنك حذفه وإرسال نسخة جديدة.");
  }
  const settings = await getSettings(db);
  const hashtags = input.hashtags !== undefined ? parseHashtags(input.hashtags) : record.hashtags;
  const title = input.title ?? record.title;
  const description = input.description ?? record.description;
  const keyFact = input.keyFact !== undefined ? (input.keyFact?.trim() || null) : record.key_fact;
  const categoryId = input.categoryId ?? record.category_id;
  if (input.categoryId && !(await categoryExists(db, categoryId))) {
    throw new ApiError(400, "invalid_category", "التصنيف المختار غير متاح.");
  }
  const flags = analyzeText([title, description, keyFact ?? "", hashtags.join(" ")].join("\n"), settings.extraBlockedTerms);
  await updatePendingText(db, videoId, {
    categoryId,
    title,
    description,
    keyFact,
    hashtags,
    searchText: buildSearchText([title, description, keyFact, await creatorName(db, record.creator_id)], hashtags),
    moderationFlags: flags,
    now,
  });
  await appendAudit(db, { actor: "owner", action: "video.edit", targetType: "video", targetId: videoId, details: {} });
}

async function creatorName(db: Sql, creatorId: string): Promise<string> {
  const rows = await db.query<{ display_name: string }>("SELECT display_name FROM creators WHERE id = $1", [creatorId]);
  return rows[0]?.display_name ?? "";
}

export async function deleteOwnerVideo(req: Request, videoId: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);
  const store = isStorageAvailable() ? getBlobStore() : null;
  await setVideoFilesAndStatus(db, videoId, { status: "deleted", deletedNow: true, now });
  await removeStoredObject(store, record);
  await appendAudit(db, { actor: "owner", action: "video.delete", targetType: "video", targetId: videoId, details: {} });
}

/** Issues a one-time recovery code. Only its keyed hash is stored; the code is shown once. */
export async function createRecoveryCode(req: Request, videoId: string): Promise<{ code: string }> {
  const db = await getDb();
  const record = await requireOwner(db, req, videoId);
  await enforceRate(db, `video:${record.id}:recovery-create`, 10, 3600);
  const code = randomRecoveryCode();
  await setRecoveryHash(db, videoId, hmacHex(normalizeRecoveryCode(code), "recovery"));
  await appendAudit(db, { actor: "owner", action: "video.recovery_created", targetType: "video", targetId: videoId, details: {} });
  return { code };
}

const recoverSchema = z.object({
  videoId: z.string().refine(isUuid, "رقم الفيديو غير صالح"),
  code: z.string().min(8).max(40),
});

/** Restores management on a new device with a one-time code. The code is consumed on success. */
export async function recoverOwnership(req: Request, body: unknown, now: Date = new Date()): Promise<{ ownerToken: string; videoId: string }> {
  const input = recoverSchema.parse(body);
  const db = await getDb();
  const ipHash = clientIpHash(req);
  await enforceRate(db, `ip:${ipHash}:recover`, 20, 3600, undefined, now);
  await enforceRate(db, `video:${input.videoId}:recover`, 10, 3600, undefined, now);
  const record = await getVideoRecord(db, input.videoId);
  if (!record || record.status === "deleted" || !record.recovery_hash) {
    throw new ApiError(404, "recovery_not_found", "رمز الاسترداد غير صحيح أو تم استخدامه من قبل.");
  }
  const provided = hmacHex(normalizeRecoveryCode(input.code), "recovery");
  if (!safeEqualHex(record.recovery_hash, provided)) {
    throw new ApiError(404, "recovery_not_found", "رمز الاسترداد غير صحيح أو تم استخدامه من قبل.");
  }
  const ownerToken = randomToken(32);
  await updateOwnerTokenHash(db, input.videoId, hmacHex(ownerToken, "owner"), true);
  await appendAudit(db, { actor: "owner", action: "video.recovered", targetType: "video", targetId: input.videoId, details: {} });
  return { ownerToken, videoId: input.videoId };
}
