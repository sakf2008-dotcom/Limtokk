import { z } from "zod";
import { adminHandler } from "@/lib/server/admin-route";
import { ApiError, json, readJson } from "@/lib/server/http";
import { isUuid } from "@/lib/server/db/params";
import { actOnReport } from "@/lib/server/services/moderation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  action: z.enum(["dismiss", "hide_target", "delete_target", "restore_target"]),
});

export const POST = adminHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "البلاغ غير موجود.");
  const { action } = schema.parse(await readJson(req));
  await actOnReport(id, action, "admin");
  return json({ ok: true });
});
