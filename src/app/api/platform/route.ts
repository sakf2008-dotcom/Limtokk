import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db/client";
import { handle, json } from "@/lib/server/http";
import { getSettings } from "@/lib/server/settings";
import { isStorageAvailable } from "@/lib/server/storage";
import type { PlatformInfoDto } from "@/lib/domain/types";

export const dynamic = "force-dynamic";

/** Public limits and mode flags the upload form needs (so the UI can warn before the server does). */
export const GET = handle(async () => {
  const settings = await getSettings(await getDb());
  const info: PlatformInfoDto = {
    demoMode: getConfig().demoMode,
    storageAvailable: isStorageAvailable(),
    uploadMaxBytes: settings.maxUploadBytes,
    maxDurationSeconds: settings.maxDurationSeconds,
    minDurationSeconds: settings.minDurationSeconds,
    commentsEnabled: settings.commentsEnabled,
  };
  return json(info);
});
