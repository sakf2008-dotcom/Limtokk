import { ApiError, deviceHashFrom, handle, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { getPlaylistVideoIds } from "@/lib/server/repo/catalog";
import { getPublicVideosByIds } from "@/lib/server/repo/videos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) throw new ApiError(404, "not_found", "المسار غير موجود.");
  const db = await getDb();
  const playlist = await getPlaylistVideoIds(db, slug);
  if (!playlist) throw new ApiError(404, "not_found", "المسار غير موجود.");
  const videos = await getPublicVideosByIds(db, playlist.videoIds, deviceHashFrom(req));
  return json({ slug, title: playlist.title, description: playlist.description, videos });
});
