import { adminHandler } from "@/lib/server/admin-route";
import { ApiError } from "@/lib/server/http";
import { isUuid } from "@/lib/server/db/params";
import { getDb } from "@/lib/server/db/client";
import { getVideoRecord } from "@/lib/server/repo/videos";
import { BUCKET_PENDING, BUCKET_PUBLIC, getBlobStore, type BucketName } from "@/lib/server/storage";
import { bodyFrom, contentTypeForKey } from "@/lib/server/range";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin preview of an upload that is still awaiting review. Supabase: a short-lived signed URL.
 * Demo storage: the file is streamed directly. Never cached.
 */
export const GET = adminHandler<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "الفيديو غير موجود.");
  const record = await getVideoRecord(await getDb(), id);
  if (!record || !record.storage_key || record.storage_bucket === "demo") {
    throw new ApiError(404, "not_found", "لا توجد معاينة متاحة لهذا الفيديو.");
  }
  const bucket: BucketName = record.storage_bucket === "public" ? BUCKET_PUBLIC : BUCKET_PENDING;
  const store = getBlobStore();

  if (store.mode === "supabase") {
    const url = await store.signedReadUrl(bucket, record.storage_key, 300);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  }
  const data = await store.readFile(bucket, record.storage_key);
  return new Response(bodyFrom(data), {
    status: 200,
    headers: {
      "Content-Type": contentTypeForKey(record.storage_key),
      "Content-Length": String(data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
