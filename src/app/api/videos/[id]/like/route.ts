import { handle, json, readJson } from "@/lib/server/http";
import { setLikeForDevice } from "@/lib/server/services/engagement";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Sets or clears this device's like. Idempotent: liking twice counts once. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  const result = await setLikeForDevice(req, id, await readJson(req));
  return json(result);
});
