import { ApiError, deviceHashFrom, handle, json, readJson } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { isUuid } from "@/lib/server/db/params";
import { getPublicVideo } from "@/lib/server/repo/videos";
import { listQuizzesForVideo } from "@/lib/server/repo/catalog";
import { deleteOwnerVideo, editOwnerVideo } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Public video details (approved videos only). */
export const GET = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const db = await getDb();
  const video = await getPublicVideo(db, id, deviceHashFrom(req));
  if (!video) throw new ApiError(404, "not_found", "الفيديو غير متاح.");
  const quizzes = await listQuizzesForVideo(db, id);
  return json({ video, quizzes });
});

/** Owner edit. Allowed only while the video is still waiting for review. Requires the owner token. */
export const PATCH = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  await editOwnerVideo(req, id, await readJson(req));
  return json({ ok: true });
});

/** Owner delete. Requires the owner token. */
export const DELETE = handle<Ctx>(async (req, ctx) => {
  const { id } = await ctx.params;
  await deleteOwnerVideo(req, id);
  return json({ ok: true });
});
