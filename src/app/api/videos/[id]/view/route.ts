import { handle, json } from "@/lib/server/http";
import { recordViewForDevice } from "@/lib/server/services/engagement";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Called by the player after about 3 seconds of playback. Counts at most once per device per day. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  await recordViewForDevice(req, id);
  return json({ ok: true });
});
