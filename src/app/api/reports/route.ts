import { handle, json, readJson } from "@/lib/server/http";
import { submitReport } from "@/lib/server/services/engagement";

export const dynamic = "force-dynamic";

/** Reports a video or comment. Each device can report a given item once. */
export const POST = handle(async (req) => {
  const result = await submitReport(req, await readJson(req));
  return json({
    ok: true,
    alreadyReported: result.alreadyReported,
    message: result.alreadyReported
      ? "أبلغت عن هذا المحتوى من قبل من هذا الجهاز. شكرًا لك."
      : "شكرًا. استلمنا بلاغك وسيراجعه فريق الإشراف.",
  });
});
