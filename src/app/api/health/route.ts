import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db/client";
import { handle, json } from "@/lib/server/http";
import { isAdminConfigured } from "@/lib/server/auth/admin";

export const dynamic = "force-dynamic";

/** Liveness and configuration summary. Contains no secrets and no identifiers. */
export const GET = handle(async () => {
  const config = getConfig();
  let database: "ok" | "unavailable" = "ok";
  try {
    await (await getDb()).query("SELECT 1");
  } catch {
    database = "unavailable";
  }
  return json({
    ok: database === "ok",
    database,
    databaseMode: config.dbMode,
    storageMode: config.storageMode,
    demoMode: config.demoMode,
    adminConfigured: isAdminConfigured(),
    secretIsEphemeral: config.secretIsEphemeral,
    cronConfigured: Boolean(config.cronSecret),
  });
});
