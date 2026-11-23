import { ApiError, handle } from "@/lib/server/http";
import { BUCKET_PUBLIC, getBlobStore } from "@/lib/server/storage";
import { bodyFrom, contentTypeForKey, parseRange } from "@/lib/server/range";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ bucket: string; key: string[] }> };

/**
 * Serves approved media in demo storage with HTTP Range support (required by iOS Safari).
 * Only the public bucket is reachable here. Pending files never leave private storage.
 * With Supabase Storage this route is not used: public URLs point straight at Supabase.
 */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { bucket, key } = await ctx.params;
  if (bucket !== BUCKET_PUBLIC) throw new ApiError(404, "not_found", "الملف غير متاح.");
  const relativeKey = key.join("/");
  const store = getBlobStore();
  if (store.mode !== "demo") throw new ApiError(404, "not_found", "الملف غير متاح.");

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
    const bytes = await store.readRange(BUCKET_PUBLIC, relativeKey, range.start, range.end - range.start + 1);
    return new Response(bodyFrom(bytes), {
      status: 206,
      headers: {
        ...common,
        "Content-Range": `bytes ${range.start}-${range.start + bytes.length - 1}/${info.size}`,
        "Content-Length": String(bytes.length),
      },
    });
  }
  const data = await store.readFile(BUCKET_PUBLIC, relativeKey);
  return new Response(bodyFrom(data), { status: 200, headers: { ...common, "Content-Length": String(info.size) } });
});
