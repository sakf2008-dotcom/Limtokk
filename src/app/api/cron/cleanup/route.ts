import { timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/server/config";
import { ApiError, handle, json } from "@/lib/server/http";
import { runCleanup } from "@/lib/server/services/cleanup";

export const dynamic = "force-dynamic";

/**
 * Scheduled retention job (see vercel.json). Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET configured, the endpoint refuses every request.
 */
export const GET = handle(async (req) => {
  const secret = getConfig().cronSecret;
  if (!secret) throw new ApiError(404, "not_found", "الصفحة غير موجودة.");
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(req.headers.get("authorization") ?? "");
  const valid = provided.length === expected.length && timingSafeEqual(provided, expected);
  if (!valid) throw new ApiError(401, "unauthorized", "غير مصرّح.");
  const summary = await runCleanup();
  return json({ ok: true, summary });
});
