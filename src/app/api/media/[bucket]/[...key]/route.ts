import { ApiError, handle } from "@/lib/server/http";
import { BUCKET_PUBLIC, getBlobStore } from "@/lib/server/storage";
import { contentTypeForKey, parseRange } from "@/lib/server/range";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bucket: string; key: string[] }> };

/**
 * Serves approved media with HTTP Range support (required by iOS Safari). Used by demo storage and by R2
 * on Cloudflare. With Supabase Storage this route is not used: public URLs point straight at Supabase.
 * Only the public bucket is reachable here. Pending files never leave private storage.
 */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { bucket, key } = await ctx.params;
  if (bucket !== BUCKET_PUBLIC) throw new ApiError(404, "not_found", "الملف غير متاح.");
  const relativeKey = key.join("/");
  const store = getBlobStore();
  if (store.mode !== "demo" && store.mode !== "r2") throw new ApiError(404, "not_found", "الملف غير متاح.");

  const info = await store.stat(BUCKET_PUBLIC, relativeKey);
  if (!info) throw new ApiError(404, "not_found", "الملف غير متاح.");

  const common = {
    "Content-Type": contentTypeForKey(relativeKey),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const range = parseRange(req.headers.get("range"), info.size);

  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${info.size}` } });
  }
  if (range.kind === "partial") {
    const length = range.end - range.start + 1;
    const body = await store.openStream(BUCKET_PUBLIC, relativeKey, { offset: range.start, length });
    if (!body) throw new ApiError(404, "not_found", "الملف غير متاح.");
    return new Response(body, {
      status: 206,
      headers: { ...common, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}`, "Content-Length": String(length) },
    });
  }
  const body = await store.openStream(BUCKET_PUBLIC, relativeKey);
  if (!body) throw new ApiError(404, "not_found", "الملف غير متاح.");
  return new Response(body, { status: 200, headers: { ...common, "Content-Length": String(info.size) } });
});
