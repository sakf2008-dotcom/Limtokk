import { getDb } from "@/lib/server/db/client";
import { handle, json } from "@/lib/server/http";
import { listCategories, listPlaylists } from "@/lib/server/repo/catalog";
import { trendingTags } from "@/lib/server/repo/videos";

export const dynamic = "force-dynamic";

/**
 * Discovery data: trending hashtags (by how many approved videos use them), categories and
 * playlists. Trending here means "most used", not a popularity forecast.
 */
export const GET = handle(async () => {
  const db = await getDb();
  const [tags, categories, playlists] = await Promise.all([
    trendingTags(db, 12),
    listCategories(db),
    listPlaylists(db),
  ]);
  return json({ tags, categories, playlists });
});
