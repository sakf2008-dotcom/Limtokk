import { handle, json, readJson } from "@/lib/server/http";
import { recoverOwnership } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

/** Restores management of a video on this device with its one-time recovery code. */
export const POST = handle(async (req) => {
  const result = await recoverOwnership(req, await readJson(req));
  return json({ ...result, note: "تمت استعادة الإدارة على هذا الجهاز. تم إبطال رمز الاسترداد السابق." });
});
