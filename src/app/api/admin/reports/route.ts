import { adminHandler } from "@/lib/server/admin-route";
import { clampInt, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { toIso } from "@/lib/server/db/params";
import { listReports } from "@/lib/server/repo/engagement";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async (req) => {
  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const status = raw === "resolved" || raw === "dismissed" ? raw : "open";
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 30, 1, 100);
  const rows = await listReports(await getDb(), status, offset, limit);
  return json({
    items: rows.map((row) => ({
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolution: row.resolution,
      createdAt: toIso(row.created_at),
      targetTitle: row.target_title,
      targetStatus: row.target_status,
      openReports: Number(row.open_reports),
    })),
  });
});
