import { clampInt, handle, json, readJson } from "@/lib/server/http";
import { listCommentsForVideo, postComment } from "@/lib/server/services/engagement";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 30, 1, 50);
  const comments = await listCommentsForVideo(id, offset, limit);
  return json({ comments, nextOffset: comments.length === limit ? offset + limit : null });
});

/**
 * Posts a comment. Suspicious comments (links, contact details, blocked terms, spam patterns)
 * are held for review. The response includes a one-time delete token, stored on this device only.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const result = await postComment(req, id, await readJson(req));
  return json(result, { status: 201 });
});
