import { getDb } from "@/lib/server/db/client";
import { handle, json } from "@/lib/server/http";
import { listCategories } from "@/lib/server/repo/catalog";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const categories = await listCategories(await getDb());
  return json({ categories });
});
