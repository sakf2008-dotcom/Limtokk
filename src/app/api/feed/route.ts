import { getDb } from "@/lib/server/db/client";
import { clampInt, deviceHashFrom, handle, json } from "@/lib/server/http";
import { fetchFeed } from "@/lib/server/repo/videos";

export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{2,40}$/;

/**
 * Feed page. tab=foryou ("لك") or tab=latest ("الأحدث"). Only approved videos are ever returned.
 * prefs is a comma-separated list of category ids chosen on this device (local preferences).
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "latest" ? "latest" : "foryou";
  const categoryParam = url.searchParams.get("category");
  const categoryId = categoryParam && SLUG.test(categoryParam) ? categoryParam : null;
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 5000);
  const limit = clampInt(url.searchParams.get("limit"), 10, 1, 20);
  const preferCategories = (url.searchParams.get("prefs") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => SLUG.test(value))
    .slice(0, 10);

  const db = await getDb();
  const items = await fetchFeed(db, {
    tab,
    categoryId,
    preferCategories,
    offset,
    limit,
    deviceHash: deviceHashFrom(req),
    now: new Date(),
  });
  return json({
    tab,
    items,
    nextOffset: items.length === limit ? offset + limit : null,
  });
});
