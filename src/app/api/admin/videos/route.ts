import { adminHandler } from "@/lib/server/admin-route";
import { clampInt, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { listAdminVideos } from "@/lib/server/repo/videos";
import { toIso } from "@/lib/server/db/params";
import type { VideoStatus } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

const STATUSES: VideoStatus[] = ["pending_upload", "pending_review", "approved", "rejected", "hidden", "expired", "deleted"];

/** Moderation list. Includes internal fields, so it is admin-only. Device identifiers are shortened. */
export const GET = adminHandler(async (req) => {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") as VideoStatus | null;
  const status = statusParam && STATUSES.includes(statusParam) ? statusParam : null;
  const text = (url.searchParams.get("q") ?? "").trim().slice(0, 80) || null;
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 50);
  const rows = await listAdminVideos(await getDb(), { status, text, offset, limit });
  return json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      keyFact: row.key_fact,
      hashtags: row.hashtags,
      status: row.status,
      categoryId: row.category_id,
      creatorId: row.creator_id,
      creatorName: row.creator_name,
      createdAt: toIso(row.created_at),
      publishedAt: toIso(row.published_at),
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      mimeType: row.mime_type,
      flags: row.moderation_flags,
      rejectionReason: row.rejection_reason,
      isFeatured: row.is_featured,
      isDemo: row.is_demo,
      reportCount: Number(row.report_count),
      likeCount: Number(row.like_count),
      viewCount: Number(row.view_count),
      submitterShortId: row.submitter_hash ? row.submitter_hash.slice(0, 10) : null,
      submitterHash: row.submitter_hash,
      previewable: !row.is_demo && Boolean(row.storage_key) && row.storage_bucket !== "demo",
    })),
  });
});
