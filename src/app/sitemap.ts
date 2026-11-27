import type { MetadataRoute } from "next";
import { getDb } from "@/lib/server/db/client";
import { indexingAllowed, siteUrl } from "@/lib/domain/site";

export const dynamic = "force-dynamic";

const MAIN_PAGES = ["/", "/explore", "/search", "/learn", "/about", "/guidelines", "/privacy", "/terms", "/copyright"];

/** The public pages, categories and learning paths. Empty until the site is open to search engines. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexingAllowed()) return [];
  const paths = [...MAIN_PAGES];
  try {
    const db = await getDb();
    const categories = await db.query<{ id: string }>("SELECT id FROM categories WHERE is_active ORDER BY sort_order, id");
    const playlists = await db.query<{ slug: string }>("SELECT slug FROM playlists WHERE is_active ORDER BY sort_order, slug");
    paths.push(...categories.map((row) => `/category/${row.id}`), ...playlists.map((row) => `/playlist/${row.slug}`));
  } catch {
    // The main pages are still listed when the database cannot be reached.
  }
  const base = siteUrl();
  const lastModified = new Date();
  return paths.map((path): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency: "daily",
    priority: path === "/" ? 1 : 0.6,
  }));
}
