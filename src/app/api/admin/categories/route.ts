import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { listAllCategories, updateCategoryByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => json({ categories: await listAllCategories() }));

export const PUT = adminHandler(async (req) => {
  await updateCategoryByAdmin(await readJson(req), "admin");
  return json({ ok: true });
});
