import { z } from "zod";
import { getDb } from "@/lib/server/db/client";
import { isUuid } from "@/lib/server/db/params";
import { ApiError, clientIpHash, handle, json, readJson, requireDeviceHash } from "@/lib/server/http";
import { enforceRate } from "@/lib/server/rate-limit";
import { checkQuizAnswer } from "@/lib/server/repo/catalog";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const answerSchema = z.object({ choiceIndex: z.number().int().min(0).max(3) });

/** Checks an answer on the server and returns the explanation. The correct option is not sent earlier. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "السؤال غير موجود.");
  const input = answerSchema.parse(await readJson(req));
  const device = requireDeviceHash(req);
  const db = await getDb();
  await enforceRate(db, `dev:${device}:quiz-answer`, 300, 3600);
  await enforceRate(db, `ip:${clientIpHash(req)}:quiz-answer`, 600, 3600);
  const result = await checkQuizAnswer(db, id, input.choiceIndex);
  if (!result) throw new ApiError(404, "not_found", "السؤال غير موجود.");
  return json(result);
});
