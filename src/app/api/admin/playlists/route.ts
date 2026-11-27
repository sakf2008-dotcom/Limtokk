import { z } from "zod";
import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { createPlaylistByAdmin, deletePlaylistByAdmin, listPlaylistsAdmin, updatePlaylistByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => json({ items: await listPlaylistsAdmin() }));

export const POST = adminHandler(async (req) => {
  const id = await createPlaylistByAdmin(await readJson(req), "admin");
  return json({ ok: true, id }, { status: 201 });
});

export const PUT = adminHandler(async (req) => {
  await updatePlaylistByAdmin(await readJson(req), "admin");
  return json({ ok: true });
});

const deleteSchema = z.object({ id: z.string() });

export const DELETE = adminHandler(async (req) => {
  const { id } = deleteSchema.parse(await readJson(req));
  await deletePlaylistByAdmin(id, "admin");
  return json({ ok: true });
});
