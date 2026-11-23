import type { SqlExecutor } from "../db/client";
import type { CategoryDto, PlaylistSummaryDto, QuizDto } from "@/lib/domain/types";

/** Categories, playlists and quizzes: slow-changing editorial data. */

interface CategoryRow {
  id: string;
  name_ar: string;
  description_ar: string;
  accent: string;
  icon: string;
  sort_order: number;
}

export function toCategory(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    nameAr: row.name_ar,
    descriptionAr: row.description_ar,
    accent: row.accent,
    icon: row.icon,
    sortOrder: Number(row.sort_order),
  };
}

export async function listCategories(db: SqlExecutor): Promise<CategoryDto[]> {
  const rows = await db.query<CategoryRow>(
    "SELECT id, name_ar, description_ar, accent, icon, sort_order FROM public_categories ORDER BY sort_order, name_ar",
  );
  return rows.map(toCategory);
}

export async function getCategory(db: SqlExecutor, id: string): Promise<CategoryDto | null> {
  const rows = await db.query<CategoryRow>(
    "SELECT id, name_ar, description_ar, accent, icon, sort_order FROM public_categories WHERE id = $1",
    [id],
  );
  return rows[0] ? toCategory(rows[0]) : null;
}

export async function categoryExists(db: SqlExecutor, id: string): Promise<boolean> {
  const rows = await db.query<{ id: string }>("SELECT id FROM categories WHERE id = $1 AND is_active", [id]);
  return rows.length > 0;
}

export async function listPlaylists(db: SqlExecutor): Promise<PlaylistSummaryDto[]> {
  const rows = await db.query<{
    slug: string;
    title_ar: string;
    description_ar: string;
    video_count: number;
  }>(
    `SELECT p.slug, p.title_ar, p.description_ar,
            (SELECT count(*)::int FROM playlist_items pi
               JOIN videos v ON v.id = pi.video_id AND v.status = 'approved'
              WHERE pi.playlist_id = p.id) AS video_count
       FROM playlists p
      WHERE p.is_active
      ORDER BY p.sort_order, p.title_ar`,
  );
  return rows.map((row) => ({
    slug: row.slug,
    titleAr: row.title_ar,
    descriptionAr: row.description_ar,
    videoCount: Number(row.video_count),
  }));
}

export async function getPlaylistVideoIds(
  db: SqlExecutor,
  slug: string,
): Promise<{ title: string; description: string; videoIds: string[] } | null> {
  const header = await db.query<{ id: string; title_ar: string; description_ar: string }>(
    "SELECT id, title_ar, description_ar FROM playlists WHERE slug = $1 AND is_active",
    [slug],
  );
  const playlist = header[0];
  if (!playlist) return null;
  const items = await db.query<{ video_id: string }>(
    `SELECT pi.video_id
       FROM playlist_items pi
       JOIN videos v ON v.id = pi.video_id AND v.status = 'approved'
      WHERE pi.playlist_id = $1
      ORDER BY pi.position`,
    [playlist.id],
  );
  return {
    title: playlist.title_ar,
    description: playlist.description_ar,
    videoIds: items.map((item) => item.video_id),
  };
}

export async function listQuizzesForVideo(db: SqlExecutor, videoId: string): Promise<QuizDto[]> {
  const rows = await db.query<{ id: string; video_id: string; question: string; options: unknown }>(
    `SELECT q.id, q.video_id, q.question, q.options
       FROM quizzes q
       JOIN videos v ON v.id = q.video_id AND v.status = 'approved'
      WHERE q.video_id = $1 AND q.is_active
      ORDER BY q.created_at`,
    [videoId],
  );
  return rows.map((row) => ({
    id: row.id,
    videoId: row.video_id,
    question: row.question,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
  }));
}

/** Server-side answer check. The correct index is never sent to the browser before an answer. */
export async function checkQuizAnswer(
  db: SqlExecutor,
  quizId: string,
  choiceIndex: number,
): Promise<{ correct: boolean; correctIndex: number; explanation: string } | null> {
  const rows = await db.query<{ correct_index: number; explanation: string; video_status: string }>(
    `SELECT q.correct_index, q.explanation, v.status AS video_status
       FROM quizzes q JOIN videos v ON v.id = q.video_id
      WHERE q.id = $1 AND q.is_active`,
    [quizId],
  );
  const row = rows[0];
  if (!row || row.video_status !== "approved") return null;
  const correctIndex = Number(row.correct_index);
  return { correct: correctIndex === choiceIndex, correctIndex, explanation: row.explanation };
}
