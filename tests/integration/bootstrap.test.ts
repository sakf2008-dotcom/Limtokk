import { afterAll, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "@/lib/server/db/client";
import { fetchFeed, searchVideos } from "@/lib/server/repo/videos";

afterAll(async () => {
  await resetDbForTests();
});

describe("database bootstrap (PGlite, same SQL as Supabase)", () => {
  it("applies migrations and seeds demo content exactly once", async () => {
    const db = await getDb();
    const migrations = await db.query<{ id: string }>("SELECT id FROM schema_migrations");
    expect(migrations.map((row) => row.id)).toContain("0001_init");

    const approved = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM videos WHERE status = 'approved'");
    expect(Number(approved[0]?.n)).toBe(9);

    const categories = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public_categories");
    expect(Number(categories[0]?.n)).toBe(10);
  });

  it("ranks 'for you' with the device's preferred category first", async () => {
    const db = await getDb();
    const feed = await fetchFeed(db, {
      tab: "foryou",
      categoryId: null,
      preferCategories: ["math"],
      offset: 0,
      limit: 9,
      deviceHash: null,
      now: new Date(),
    });
    expect(feed).toHaveLength(9);
    expect(feed[0]?.categoryId).toBe("math");
    expect(feed.every((card) => card.isDemo)).toBe(true);
    expect(feed.every((card) => card.mediaUrl.startsWith("/demo-media/"))).toBe(true);
  });

  it("'latest' orders by publication time, newest first", async () => {
    const db = await getDb();
    const feed = await fetchFeed(db, {
      tab: "latest",
      categoryId: null,
      preferCategories: [],
      offset: 0,
      limit: 9,
      deviceHash: null,
      now: new Date(),
    });
    const times = feed.map((card) => new Date(card.publishedAt ?? 0).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("searches Arabic text regardless of diacritics and letter variants", async () => {
    const db = await getDb();
    const byTitle = await searchVideos(db, {
      text: "الفضاء",
      categoryId: null,
      tag: null,
      creatorId: null,
      offset: 0,
      limit: 10,
      deviceHash: null,
    });
    expect(byTitle.some((card) => card.categoryId === "space")).toBe(true);

    const byHashtag = await searchVideos(db, {
      text: null,
      categoryId: null,
      tag: "رياضيات",
      creatorId: null,
      offset: 0,
      limit: 10,
      deviceHash: null,
    });
    expect(byHashtag.map((card) => card.id)).toContain("20000000-0000-4000-8000-000000000003");
  });

  it("exposes the public view without any secret columns", async () => {
    const db = await getDb();
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'public_videos'`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain("owner_token_hash");
    expect(names).not.toContain("recovery_hash");
    expect(names).not.toContain("submitter_hash");
  });
});
