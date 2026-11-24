import { adminHandler } from "@/lib/server/admin-route";
import { ApiError } from "@/lib/server/http";
import { isUuid } from "@/lib/server/db/params";
import { getDb } from "@/lib/server/db/client";
import { getVideoRecord } from "@/lib/server/repo/videos";
import { BUCKET_PENDING, BUCKET_PUBLIC, getBlobStore, type BucketName } from "@/lib/server/storage";
import { contentTypeForKey, parseRange } from "@/lib/server/range";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin preview of an upload that is still awaiting review. Supabase: a short-lived signed URL.
 * Demo and R2 storage: the file is streamed directly, with Range support so iPhone Safari can play it.
 * Never cached.
 */
export const GET = adminHandler<Ctx>(async (req, ctx) => {
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
  const info = await store.stat(bucket, record.storage_key);
  if (!info) throw new ApiError(404, "not_found", "لا توجد معاينة متاحة لهذا الفيديو.");
  const common = {
    "Content-Type": contentTypeForKey(record.storage_key),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), info.size);
  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${info.size}` } });
  }
  if (range.kind === "partial") {
    const length = range.end - range.start + 1;
    const body = await store.openStream(bucket, record.storage_key, { offset: range.start, length });
    if (!body) throw new ApiError(404, "not_found", "لا توجد معاينة متاحة لهذا الفيديو.");
    return new Response(body, {
      status: 206,
      headers: { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": String(length) },
    });
  }
  const body = await store.openStream(bucket, record.storage_key);
  if (!body) throw new ApiError(404, "not_found", "لا توجد معاينة متاحة لهذا الفيديو.");
  return new Response(body, { status: 200, headers: { ...common, "Content-Length": String(info.size) } });
});
