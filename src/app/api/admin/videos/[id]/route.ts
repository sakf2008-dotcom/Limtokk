import { z } from "zod";
import { adminHandler } from "@/lib/server/admin-route";
import { ApiError, json, readJson } from "@/lib/server/http";
import { isUuid } from "@/lib/server/db/params";
import { approveVideo, deleteVideoByAdmin, hideVideo, rejectVideo, restoreVideo, setVideoFeatured } from "@/lib/server/services/moderation";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "hide", "restore", "delete", "feature", "unfeature"]),
  reason: z.string().trim().max(200).optional(),
  rank: z.number().int().min(1).max(999).nullish(),
});

/** Single moderation action on a video. Every action is audited. */
export const POST = adminHandler<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "الفيديو غير موجود.");
  const input = actionSchema.parse(await readJson(req));
  const actor = "admin";
  const reason = input.reason?.trim() || "مخالف لإرشادات المجتمع";

  switch (input.action) {
    case "approve":
      await approveVideo(id, actor);
      break;
    case "reject":
      await rejectVideo(id, actor, reason);
      break;
    case "hide":
      await hideVideo(id, actor, reason);
      break;
    case "restore":
      await restoreVideo(id, actor);
      break;
    case "delete":
      await deleteVideoByAdmin(id, actor, reason);
      break;
    case "feature":
      await setVideoFeatured(id, actor, true, input.rank ?? null);
      break;
    case "unfeature":
      await setVideoFeatured(id, actor, false, null);
      break;
  }
  return json({ ok: true });
});
