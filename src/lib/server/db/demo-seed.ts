import catalog from "@/lib/demo/catalog.json";
import { buildSearchText } from "@/lib/domain/text";
import { randomToken, sha256Hex } from "../crypto";
import type { Sql } from "./client";

/** Seed slide duration used by scripts/generate-demo-media.mjs. Keep both in sync. */
export const DEMO_SLIDE_MS = 3500;

/**
 * Loads the developer-written demo catalog into an empty in-memory database.
 * Demo rows are flagged `is_demo`, have zero engagement, and cannot be managed by anyone.
 * Only runs when the database has no videos yet, so it never duplicates content.
 */
export async function seedDemoData(db: Sql): Promise<void> {
  const existing = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM videos");
  if (Number(existing[0]?.n ?? 0) > 0) return;

  const now = Date.now();
  await db.transaction(async (tx) => {
    for (const creator of catalog.creators) {
      await tx.query(
        "INSERT INTO creators (id, display_name, avatar_key) VALUES ($1::uuid, $2, $3) ON CONFLICT (id) DO NOTHING",
        [creator.id, creator.name, creator.avatar],
      );
    }

    for (const video of catalog.videos) {
      const creatorName = catalog.creators.find((creator) => creator.id === video.creatorId)?.name ?? "";
      const publishedAt = new Date(now - video.publishedHoursAgo * 3_600_000).toISOString();
      const durationMs = video.slides.length * DEMO_SLIDE_MS;
      const ownerTokenHash = sha256Hex(randomToken(32));
      await tx.query(
        `INSERT INTO videos (
           id, creator_id, category_id, title, description, key_fact, hashtags, search_text,
           status, is_demo, storage_bucket, storage_key, poster_key, mime_type,
           duration_ms, width, height, owner_token_hash, published_at, created_at, updated_at,
           is_featured, featured_rank
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5, $6, $7::text[], $8,
           'approved', true, 'demo', $9, $10, 'video/mp4',
           $11, 720, 1280, $12, $13::timestamptz, $13::timestamptz, $13::timestamptz,
           $14, $15
         )`,
        [
          video.id,
          video.creatorId,
          video.categoryId,
          video.title,
          video.description,
          video.keyFact,
          video.hashtags,
          buildSearchText([video.title, video.description, video.keyFact, creatorName], video.hashtags),
          `${video.slug}.mp4`,
          `${video.slug}.jpg`,
          durationMs,
          ownerTokenHash,
          publishedAt,
          video.featuredRank !== null,
          video.featuredRank,
        ],
      );

      await tx.query(
        `INSERT INTO quizzes (video_id, question, options, correct_index, explanation)
         VALUES ($1::uuid, $2, $3::jsonb, $4, $5)`,
        [
          video.id,
          video.quiz.question,
          JSON.stringify(video.quiz.options),
          video.quiz.correctIndex,
          video.quiz.explanation,
        ],
      );
    }

    for (const [index, playlist] of catalog.playlists.entries()) {
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO playlists (slug, title_ar, description_ar, sort_order)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [playlist.slug, playlist.titleAr, playlist.descriptionAr, index + 1],
      );
      const playlistId = rows[0]?.id;
      if (!playlistId) continue;
      const videoIds = playlist.videos
        .map((slug) => catalog.videos.find((video) => video.slug === slug)?.id)
        .filter((id): id is string => Boolean(id));
      for (const [position, videoId] of videoIds.entries()) {
        await tx.query(
          "INSERT INTO playlist_items (playlist_id, video_id, position) VALUES ($1::uuid, $2::uuid, $3)",
          [playlistId, videoId, position],
        );
      }
    }
  });
}
