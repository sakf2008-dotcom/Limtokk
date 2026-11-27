import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { addPlaylistItemByAdmin, removePlaylistItemByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const POST = adminHandler(async (req) => {
  await addPlaylistItemByAdmin(await readJson(req), "admin");
  return json({ ok: true }, { status: 201 });
});

export const DELETE = adminHandler(async (req) => {
  await removePlaylistItemByAdmin(await readJson(req), "admin");
  return json({ ok: true });
});
