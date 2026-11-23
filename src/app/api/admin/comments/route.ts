import { adminHandler } from "@/lib/server/admin-route";
import { clampInt, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { listPendingComments } from "@/lib/server/repo/engagement";
import { FLAG_LABELS_AR } from "@/lib/server/moderation";

export const dynamic = "force-dynamic";

/** Held comments (status=pending) and hidden comments (status=hidden), for admin review. */
export const GET = adminHandler(async (req) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") === "hidden" ? "hidden" : "pending";
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 30, 1, 100);
  const rows = await listPendingComments(await getDb(), status, offset, limit);
  return json({
    items: rows.map((row) => ({
      id: row.id,
      videoId: row.video_id,
      videoTitle: row.video_title,
      authorName: row.author_name,
      body: row.body,
      status: row.status,
      flags: row.moderation_flags.map((flag) => FLAG_LABELS_AR[flag as keyof typeof FLAG_LABELS_AR] ?? flag),
      createdAt: row.created_iso,
    })),
  });
});
