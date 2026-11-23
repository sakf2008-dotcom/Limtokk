import { getDb } from "@/lib/server/db/client";
import { clampInt, deviceHashFrom, handle, json } from "@/lib/server/http";
import { searchCreators, searchVideos } from "@/lib/server/repo/videos";
import { normalizeArabic, normalizeHashtag } from "@/lib/domain/text";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{2,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Search across title, description, hashtags and creator nickname (type=videos),
 * or creators only (type=creators). Matching is on Arabic-normalized text.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const rawQuery = (url.searchParams.get("q") ?? "").slice(0, 80);
  const q = normalizeArabic(rawQuery).replace(/^#/, "");
  const type = url.searchParams.get("type") === "creators" ? "creators" : "videos";
  const categoryParam = url.searchParams.get("category");
  const tagParam = url.searchParams.get("tag");
  const creatorParam = url.searchParams.get("creator");
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 12, 1, 30);
  const db = await getDb();

  if (type === "creators") {
    if (q.length < 2) return json({ type, items: [] });
    return json({ type, items: await searchCreators(db, q, limit) });
  }

  const tag = tagParam ? normalizeHashtag(tagParam) : null;
  const hasFilter = q.length > 0 || Boolean(categoryParam) || Boolean(tag) || Boolean(creatorParam);
  if (!hasFilter) return json({ type, items: [], nextOffset: null });

  const items = await searchVideos(db, {
    text: q.length > 0 ? q : null,
    categoryId: categoryParam && SLUG.test(categoryParam) ? categoryParam : null,
    tag,
    creatorId: creatorParam && UUID.test(creatorParam) ? creatorParam : null,
    offset,
    limit,
    deviceHash: deviceHashFrom(req),
  });
  return json({ type, items, nextOffset: items.length === limit ? offset + limit : null });
});
