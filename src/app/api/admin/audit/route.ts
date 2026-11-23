import { adminHandler } from "@/lib/server/admin-route";
import { clampInt, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { listAudit } from "@/lib/server/repo/ops";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async (req) => {
  const url = new URL(req.url);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100_000);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  return json({ items: await listAudit(await getDb(), offset, limit) });
});
