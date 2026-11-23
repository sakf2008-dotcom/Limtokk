import { z } from "zod";
import { getDb } from "../db/client";
import { isUuid } from "../db/params";
import { ApiError, bearerToken, clientIpHash, requireDeviceHash } from "../http";
import { hmacHex, randomToken, safeEqualHex } from "../crypto";
import { enforceRate } from "../rate-limit";
import { analyzeText } from "../moderation";
import { getSettings } from "../settings";
import { isDeviceBlocked, bumpDailyStat, appendAudit } from "../repo/ops";
import {
  countOpenReports,
  countRecentCommentsByDevice,
  getComment,
  hasDuplicateComment,
  insertComment,
  insertReport,
  listVisibleComments,
  recordVideoView,
  setCommentStatus,
  setVideoLike,
  syncVideoReportCount,
} from "../repo/engagement";
import { setVideoFilesAndStatus } from "../repo/videos";
import { issuePowChallenge, verifyAndConsumePow } from "../pow";
import type { CommentDto } from "@/lib/domain/types";

/** Likes, views, comments and reports from anonymous devices, with rate limits on every write. */

const NICKNAME_PATTERN = /^[\p{L}\p{M}\p{N} _.-]+$/u;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const likeSchema = z.object({ liked: z.boolean() });

const challengeSchema = z.object({ token: z.string().min(10).max(500), nonce: z.string().min(1).max(20) });

const commentSchema = z.object({
  nickname: z
    .string()
    .trim()
    .min(2, "الاسم قصير جدًا")
    .max(24, "الاسم طويل جدًا")
    .regex(NICKNAME_PATTERN, "الاسم يقبل الحروف والأرقام والمسافة فقط"),
  body: z.string().trim().min(1, "اكتب تعليقك أولًا").max(300, "التعليق طويل جدًا (300 حرف كحد أقصى)"),
  parentId: z.string().nullish(),
  challenge: challengeSchema.optional(),
});

const REPORT_REASONS = ["inappropriate", "misleading", "spam", "harassment", "copyright", "privacy", "other"] as const;

const reportSchema = z.object({
  targetType: z.enum(["video", "comment"]),
  targetId: z.string(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).nullish(),
});

const BLOCKED_MESSAGE = "أُوقف إرسال المحتوى مؤقتًا من هذا الجهاز بسبب مخالفات متكررة.";

async function ensurePublicVideo(videoId: string): Promise<void> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("SELECT id FROM videos WHERE id = $1::uuid AND status = 'approved'", [videoId]);
  if (rows.length === 0) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
}

export async function setLikeForDevice(req: Request, videoId: string, body: unknown, now: Date = new Date()) {
  const input = likeSchema.parse(body);
  if (!isUuid(videoId)) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const device = requireDeviceHash(req);
  const db = await getDb();
  await enforceRate(db, `dev:${device}:like`, 120, 60, undefined, now);
  await enforceRate(db, `ip:${clientIpHash(req)}:like`, 600, 60, undefined, now);
  await ensurePublicVideo(videoId);

  const before = await db.query<{ liked: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM video_likes WHERE video_id = $1::uuid AND device_hash = $2) AS liked",
    [videoId, device],
  );
  const result = await setVideoLike(db, videoId, device, input.liked);
  if (input.liked && !before[0]?.liked && result.liked) {
    await bumpDailyStat(db, "likes", 1, now);
  }
  return result;
}

export async function recordViewForDevice(req: Request, videoId: string, now: Date = new Date()): Promise<void> {
  if (!isUuid(videoId)) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const device = requireDeviceHash(req);
  const db = await getDb();
  await enforceRate(db, `dev:${device}:view`, 300, 60, undefined, now);
  await ensurePublicVideo(videoId);
  await recordVideoView(db, videoId, device, now.toISOString().slice(0, 10));
}

export async function listCommentsForVideo(videoId: string, offset: number, limit: number): Promise<CommentDto[]> {
  if (!isUuid(videoId)) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const db = await getDb();
  await ensurePublicVideo(videoId);
  return listVisibleComments(db, videoId, offset, limit);
}

export interface PostCommentResult {
  id: string;
  status: "visible" | "pending";
  deleteToken: string;
  message: string;
}

export async function postComment(req: Request, videoId: string, body: unknown, now: Date = new Date()): Promise<PostCommentResult> {
  const input = commentSchema.parse(body);
  if (!isUuid(videoId)) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const db = await getDb();
  const settings = await getSettings(db);
  if (!settings.commentsEnabled) {
    throw new ApiError(403, "comments_disabled", "التعليقات متوقفة مؤقتًا.");
  }
  await ensurePublicVideo(videoId);

  const device = requireDeviceHash(req);
  if (await isDeviceBlocked(db, device, now)) throw new ApiError(403, "device_blocked", BLOCKED_MESSAGE);

  const rateMessage = "أنت تعلّق بسرعة كبيرة. انتظر قليلًا ثم حاول مرة أخرى.";
  await enforceRate(db, `dev:${device}:comment`, 6, 60, rateMessage, now);
  await enforceRate(db, `dev:${device}:comment-day`, 80, 86_400, "وصلت إلى الحد اليومي للتعليقات.", now);
  await enforceRate(db, `ip:${clientIpHash(req)}:comment`, 120, 60, rateMessage, now);

  const recent = await countRecentCommentsByDevice(db, device, new Date(now.getTime() - TEN_MINUTES_MS));
  if (recent >= settings.commentChallengeAfterRecent) {
    if (!input.challenge) {
      throw new ApiError(428, "challenge_required", "للحماية من الإرسال الآلي، أكمل تحققًا قصيرًا ثم أعد المحاولة.", {
        challenge: issuePowChallenge(now),
      });
    }
    await verifyAndConsumePow(input.challenge, now, db);
  }

  if (await hasDuplicateComment(db, device, input.body, new Date(now.getTime() - TEN_MINUTES_MS))) {
    throw new ApiError(409, "duplicate_comment", "نشرت هذا التعليق قبل قليل. غيّر النص إن أردت نشره من جديد.");
  }

  let parentId: string | null = null;
  if (input.parentId) {
    if (!isUuid(input.parentId)) throw new ApiError(400, "invalid_parent", "الرد لا يمكن إرساله على هذا التعليق.");
    const parent = await getComment(db, input.parentId);
    if (!parent || parent.video_id !== videoId || parent.status !== "visible" || parent.parent_id !== null) {
      throw new ApiError(400, "invalid_parent", "الرد لا يمكن إرساله على هذا التعليق.");
    }
    parentId = parent.id;
  }

  const flags = analyzeText([input.nickname, input.body].join("\n"), settings.extraBlockedTerms);
  const status = flags.length > 0 ? "pending" : "visible";
  const deleteToken = randomToken(24);
  const id = await insertComment(db, {
    videoId,
    parentId,
    authorName: input.nickname,
    body: input.body,
    status,
    flags,
    deviceHash: device,
    deleteTokenHash: hmacHex(deleteToken, "comment-delete"),
  });
  if (status === "visible") await bumpDailyStat(db, "comments", 1, now);

  return {
    id,
    status,
    deleteToken,
    message:
      status === "visible"
        ? "تم نشر تعليقك."
        : "تعليقك يحتاج مراجعة قبل ظهوره للجميع. شكرًا لصبرك.",
  };
}

/** Deletes a comment with the secret token returned at creation. Possession of the token is the proof. */
export async function deleteOwnComment(req: Request, commentId: string): Promise<void> {
  if (!isUuid(commentId)) throw new ApiError(404, "not_found", "التعليق غير موجود.");
  const token = bearerToken(req);
  if (!token) throw new ApiError(401, "comment_token_required", "هذا الإجراء يتطلب رمز حذف التعليق المحفوظ على هذا الجهاز.");
  const db = await getDb();
  const comment = await getComment(db, commentId);
  if (!comment || comment.status === "deleted") throw new ApiError(404, "not_found", "التعليق غير موجود.");
  if (!safeEqualHex(comment.delete_token_hash, hmacHex(token, "comment-delete"))) {
    throw new ApiError(403, "comment_token_mismatch", "رمز الحذف لا يطابق هذا التعليق.");
  }
  await setCommentStatus(db, commentId, "deleted", "author", { redactBody: true });
}

export async function submitReport(req: Request, body: unknown, now: Date = new Date()): Promise<{ alreadyReported: boolean }> {
  const input = reportSchema.parse(body);
  if (!isUuid(input.targetId)) throw new ApiError(404, "not_found", "المحتوى غير موجود.");
  const device = requireDeviceHash(req);
  const db = await getDb();
  const settings = await getSettings(db);
  await enforceRate(db, `dev:${device}:report`, 30, 3600, undefined, now);
  await enforceRate(db, `ip:${clientIpHash(req)}:report`, 120, 3600, undefined, now);

  if (input.targetType === "video") {
    await ensurePublicVideo(input.targetId);
  } else {
    const comment = await getComment(db, input.targetId);
    if (!comment || comment.status !== "visible") throw new ApiError(404, "not_found", "التعليق غير متاح.");
  }

  const inserted = await insertReport(db, {
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    details: input.details?.trim() ? input.details.trim() : null,
    reporterHash: device,
  });
  if (!inserted) return { alreadyReported: true };

  await bumpDailyStat(db, "reports", 1, now);
  const openCount = await countOpenReports(db, input.targetType, input.targetId);
  if (input.targetType === "video") {
    await syncVideoReportCount(db, input.targetId);
    if (openCount >= settings.reportAutoHideThreshold) {
      // Automatic, temporary hiding only. A human must still review the report.
      await setVideoFilesAndStatus(db, input.targetId, { status: "hidden", now });
      await appendAudit(db, {
        actor: "system",
        action: "video.auto_hide_reports",
        targetType: "video",
        targetId: input.targetId,
        details: { openReports: openCount },
      });
    }
  } else if (openCount >= settings.reportAutoHideThreshold) {
    await setCommentStatus(db, input.targetId, "hidden", "system");
    await appendAudit(db, {
      actor: "system",
      action: "comment.auto_hide_reports",
      targetType: "comment",
      targetId: input.targetId,
      details: { openReports: openCount },
    });
  }
  return { alreadyReported: false };
}
