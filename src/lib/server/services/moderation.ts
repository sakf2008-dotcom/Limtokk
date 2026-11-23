import { getDb, type Sql } from "../db/client";
import { ApiError } from "../http";
import { BUCKET_PENDING, BUCKET_PUBLIC, getBlobStore, isStorageAvailable, type BlobStore } from "../storage";
import { getVideoRecord, setVideoFilesAndStatus, type VideoRecord } from "../repo/videos";
import { appendAudit, bumpDailyStat } from "../repo/ops";
import { getComment, resolveReportById, resolveReportsFor, setCommentStatus } from "../repo/engagement";

/**
 * Human moderation actions. Every function re-reads current state, enforces allowed transitions,
 * and writes an audit log entry. The admin API calls these; they are never reachable without
 * an authenticated admin session.
 */

const PUBLIC_BUCKET_NAME = BUCKET_PUBLIC;

async function loadVideo(db: Sql, id: string): Promise<VideoRecord> {
  const record = await getVideoRecord(db, id);
  if (!record) throw new ApiError(404, "not_found", "الفيديو غير موجود.");
  return record;
}

async function deleteObjectFor(store: BlobStore | null, record: VideoRecord): Promise<void> {
  if (!store || !record.storage_key) return;
  const bucket = record.storage_bucket === "pending" ? BUCKET_PENDING : record.storage_bucket === "public" ? PUBLIC_BUCKET_NAME : null;
  if (!bucket) return;
  try {
    await store.remove(bucket, [record.storage_key]);
  } catch (error) {
    console.error("[moderation] storage delete failed; cleanup will retry:", error);
  }
}

export async function approveVideo(id: string, actor: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  if (record.status === "approved") return;
  if (record.status !== "pending_review" && record.status !== "hidden") {
    throw new ApiError(409, "invalid_transition", "لا يمكن نشر هذا الفيديو في حالته الحالية.");
  }

  let bucket: "public" | undefined;
  if (record.storage_bucket === "pending") {
    if (!record.storage_key || !isStorageAvailable()) {
      throw new ApiError(409, "file_missing", "ملف الفيديو غير متوفر للنقل إلى التخزين العام.");
    }
    const store = getBlobStore();
    try {
      await store.copy(BUCKET_PENDING, record.storage_key, PUBLIC_BUCKET_NAME, record.storage_key);
    } catch (error) {
      console.error("[moderation] copy to public bucket failed:", error);
      throw new ApiError(502, "storage_copy_failed", "تعذّر نقل الفيديو إلى التخزين العام. حاول مرة أخرى.");
    }
    await deleteObjectFor(store, { ...record, storage_bucket: "pending" });
    bucket = "public";
  }

  await setVideoFilesAndStatus(db, id, {
    status: "approved",
    storageBucket: bucket,
    publishedAt: record.published_at ? new Date(record.published_at) : now,
    reviewedBy: actor,
    reviewedNow: true,
    rejectionReason: null,
    now,
  });
  await bumpDailyStat(db, "approvals", 1, now);
  await appendAudit(db, { actor, action: "video.approve", targetType: "video", targetId: id, details: {} });
}

export async function rejectVideo(id: string, actor: string, reason: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  if (record.status === "rejected") return;
  if (record.status === "deleted" || record.status === "expired" || record.status === "pending_upload") {
    throw new ApiError(409, "invalid_transition", "لا يمكن رفض هذا الفيديو في حالته الحالية.");
  }
  await setVideoFilesAndStatus(db, id, {
    status: "rejected",
    rejectionReason: reason,
    reviewedBy: actor,
    reviewedNow: true,
    now,
  });
  await deleteObjectFor(isStorageAvailable() ? getBlobStore() : null, record);
  await bumpDailyStat(db, "rejections", 1, now);
  await appendAudit(db, { actor, action: "video.reject", targetType: "video", targetId: id, details: { reason } });
}

export async function hideVideo(id: string, actor: string, reason: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  if (record.status !== "approved" && record.status !== "pending_review") {
    throw new ApiError(409, "invalid_transition", "لا يمكن إخفاء هذا الفيديو في حالته الحالية.");
  }
  await setVideoFilesAndStatus(db, id, { status: "hidden", reviewedBy: actor, reviewedNow: true, now });
  await appendAudit(db, { actor, action: "video.hide", targetType: "video", targetId: id, details: { reason } });
}

export async function restoreVideo(id: string, actor: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  if (record.status !== "hidden") {
    throw new ApiError(409, "invalid_transition", "هذا الفيديو ليس مخفيًا.");
  }
  if (record.storage_bucket !== "public") {
    // Hidden before approval (file still in the private bucket): it goes through the publish path.
    await approveVideo(id, actor, now);
    return;
  }
  await setVideoFilesAndStatus(db, id, { status: "approved", reviewedBy: actor, reviewedNow: true, now });
  await appendAudit(db, { actor, action: "video.restore", targetType: "video", targetId: id, details: {} });
}

export async function deleteVideoByAdmin(id: string, actor: string, reason: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  await setVideoFilesAndStatus(db, id, { status: "deleted", deletedNow: true, reviewedBy: actor, reviewedNow: true, now });
  await deleteObjectFor(isStorageAvailable() ? getBlobStore() : null, record);
  await appendAudit(db, { actor, action: "video.delete", targetType: "video", targetId: id, details: { reason } });
}

export async function setVideoFeatured(id: string, actor: string, featured: boolean, rank: number | null): Promise<void> {
  const db = await getDb();
  const record = await loadVideo(db, id);
  if (featured && record.status !== "approved") {
    throw new ApiError(409, "invalid_transition", "يمكن تمييز الفيديوهات المنشورة فقط.");
  }
  await db.query(
    "UPDATE videos SET is_featured = $2, featured_rank = $3, updated_at = now() WHERE id = $1",
    [id, featured, featured ? rank : null],
  );
  await appendAudit(db, {
    actor,
    action: featured ? "video.feature" : "video.unfeature",
    targetType: "video",
    targetId: id,
    details: { rank },
  });
}

export async function moderateComment(
  id: string,
  action: "approve" | "hide" | "delete",
  actor: string,
): Promise<void> {
  const db = await getDb();
  const comment = await getComment(db, id);
  if (!comment) throw new ApiError(404, "not_found", "التعليق غير موجود.");
  const status = action === "approve" ? "visible" : action === "hide" ? "hidden" : "deleted";
  await setCommentStatus(db, id, status, actor, { redactBody: action === "delete" });
  await appendAudit(db, { actor, action: `comment.${action}`, targetType: "comment", targetId: id, details: {} });
}

export type ReportAction = "dismiss" | "hide_target" | "delete_target" | "restore_target";

export async function actOnReport(reportId: string, action: ReportAction, actor: string, now: Date = new Date()): Promise<void> {
  const db = await getDb();
  if (action === "dismiss") {
    const done = await resolveReportById(db, reportId, "dismissed", "لم يُعتبر مخالفًا", actor);
    if (!done) throw new ApiError(404, "not_found", "البلاغ غير موجود أو تمت معالجته.");
    await appendAudit(db, { actor, action: "report.dismiss", targetType: "report", targetId: reportId, details: {} });
    return;
  }

  const rows = await db.query<{ target_type: "video" | "comment"; target_id: string }>(
    "SELECT target_type, target_id FROM reports WHERE id = $1::uuid",
    [reportId],
  );
  const target = rows[0];
  if (!target) throw new ApiError(404, "not_found", "البلاغ غير موجود.");

  if (target.target_type === "video") {
    const video = await loadVideo(db, target.target_id);
    if (action === "hide_target") {
      if (video.status === "approved" || video.status === "pending_review") {
        await setVideoFilesAndStatus(db, video.id, { status: "hidden", reviewedBy: actor, reviewedNow: true, now });
      }
    } else if (action === "restore_target") {
      if (video.status === "hidden" && video.storage_bucket === "public") {
        await setVideoFilesAndStatus(db, video.id, { status: "approved", reviewedBy: actor, reviewedNow: true, now });
      }
    } else if (action === "delete_target") {
      await setVideoFilesAndStatus(db, video.id, { status: "deleted", deletedNow: true, reviewedBy: actor, reviewedNow: true, now });
      await deleteObjectFor(isStorageAvailable() ? getBlobStore() : null, video);
    }
  } else {
    if (action === "hide_target") await setCommentStatus(db, target.target_id, "hidden", actor);
    if (action === "restore_target") await setCommentStatus(db, target.target_id, "visible", actor);
    if (action === "delete_target") await setCommentStatus(db, target.target_id, "deleted", actor, { redactBody: true });
  }

  await resolveReportsFor(
    db,
    target.target_type,
    target.target_id,
    "resolved",
    action === "hide_target" ? "تم الإخفاء" : action === "delete_target" ? "تم الحذف" : "تمت الاستعادة",
    actor,
  );
  await appendAudit(db, {
    actor,
    action: `report.${action}`,
    targetType: target.target_type,
    targetId: target.target_id,
    details: { reportId },
  });
}
