import { handle, json } from "@/lib/server/http";
import { receiveDemoContent } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Demo storage only (local development). Production uploads go straight to Supabase Storage. */
export const PUT = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  await receiveDemoContent(req, id);
  return json({ ok: true });
});
