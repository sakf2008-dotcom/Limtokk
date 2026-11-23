import { handle, json } from "@/lib/server/http";
import { deleteOwnComment } from "@/lib/server/services/engagement";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Deletes a comment. Requires the comment's delete token (Authorization: Bearer ...). */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  await deleteOwnComment(req, id);
  return json({ ok: true });
});
