import { handle, json } from "@/lib/server/http";
import { getOwnerStatus } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Management view for the owner. Requires the owner token in the Authorization header. */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  return json(await getOwnerStatus(req, id));
});
