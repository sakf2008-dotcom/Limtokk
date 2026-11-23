import { ApiError, clampInt, deviceHashFrom, handle, json } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { isUuid } from "@/lib/server/db/params";
import { getCreatorProfile, searchVideos } from "@/lib/server/repo/videos";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Public creator page. The creator is a pseudonymous identity chosen on one device. It is not a
 * verified person, and two creators can share a nickname.
 */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "الصفحة غير موجودة.");
  const url = new URL(req.url);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 12, 1, 30);
  const db = await getDb();
  const profile = await getCreatorProfile(db, id);
  if (!profile) throw new ApiError(404, "not_found", "الصفحة غير موجودة.");

  const videos = await searchVideos(db, {
    text: null,
    categoryId: null,
    tag: null,
    creatorId: id,
    offset,
    limit,
    deviceHash: deviceHashFrom(req),
  });
  return json({
    creator: {
      id: profile.id,
      name: profile.display_name,
      avatar: profile.avatar_key,
      videoCount: Number(profile.video_count),
      totalViews: Number(profile.total_views),
      totalLikes: Number(profile.total_likes),
      verified: false,
    },
    videos,
    nextOffset: videos.length === limit ? offset + limit : null,
  });
});
