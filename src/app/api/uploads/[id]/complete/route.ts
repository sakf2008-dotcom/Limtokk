import { handle, json } from "@/lib/server/http";
import { completeUpload } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Upload step 2: the server inspects the stored file. Passing files wait for human review.
 * Failing files are deleted at once and the reason is returned.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  return json(await completeUpload(req, id));
});
