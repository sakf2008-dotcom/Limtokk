import { handle, json, readJson } from "@/lib/server/http";
import { initUpload } from "@/lib/server/services/uploads";

export const dynamic = "force-dynamic";

/**
 * Upload step 1: validates everything and reserves a pending record. Returns a one-time owner token
 * and a short-lived upload target. The file is NOT public, and nothing is published until approval.
 */
export const POST = handle(async (req) => {
  const result = await initUpload(req, await readJson(req, 32 * 1024));
  return json(result, { status: 201 });
});
