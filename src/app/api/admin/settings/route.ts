import { adminHandler } from "@/lib/server/admin-route";
import { json, readJson } from "@/lib/server/http";
import { getDb } from "@/lib/server/db/client";
import { getSettings, SETTING_LIMITS } from "@/lib/server/settings";
import { updateSettingsByAdmin } from "@/lib/server/services/admin";

export const dynamic = "force-dynamic";

export const GET = adminHandler(async () => {
  const settings = await getSettings(await getDb());
  return json({ settings, limits: SETTING_LIMITS });
});

export const PUT = adminHandler(async (req) => {
  const settings = await updateSettingsByAdmin(await readJson(req), "admin");
  return json({ settings });
});
